import { writeFileSync } from 'node:fs'
import { computeEvolution, getCommitAuthor, getRemoteUrl, buildCommitUrl } from '../../core/search/evolution.js'
import { applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { getBranchBlobHashSet } from '../../core/search/vectorSearch.js'
import { formatDate, shortHash } from '../../core/search/ranking.js'
import { getBlobContent } from '../../core/indexing/blobStore.js'
import type { EvolutionEntry } from '../../core/search/evolution.js'
import { remoteFileEvolution } from '../../client/remoteClient.js'
import { renderFileEvolutionHtml } from '../../core/viz/htmlRenderer.js'
import { narrateEvolution } from '../../core/llm/narrator.js'

export interface EvolutionCommandOptions {
  threshold?: string
  dump?: string | boolean
  html?: string | boolean
  level?: string
  includeContent?: boolean
  origin?: string
  remote?: string
  branch?: string
  /** Top-N largest-jump alerts. Pass `true` for default 5, or a numeric string for a custom count. */
  alerts?: string | boolean
  /** When true, generate an LLM narrative summary of the semantic evolution (Phase 56). */
  narrate?: boolean
  // CLI model overrides
  model?: string
  textModel?: string
  codeModel?: string
  noHeadings?: boolean
}

/** A single alert entry – one of the top-N largest semantic jumps for a file. */
export interface EvolutionAlert {
  rank: number
  /** 0-based index in the full evolution timeline. */
  index: number
  date: string
  blobHash: string
  commitHash: string
  distFromPrev: number
  distFromOrigin: number
  /** Git commit author in "Name <email>" format, if resolvable. */
  author?: string
  /** Web link to the commit on GitHub / GitLab / Bitbucket, if the remote is recognised. */
  commitUrl?: string
}

/**
 * Extracts the top-N largest semantic jumps (by `distFromPrev`) from an
 * evolution timeline, sorted descending by delta score.
 */
export function buildAlerts(
  entries: EvolutionEntry[],
  threshold: number,
  topN: number,
): Array<{ entry: EvolutionEntry; index: number }> {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => index > 0)
    .filter(({ entry }) => entry.distFromPrev >= threshold)
    .sort((a, b) => b.entry.distFromPrev - a.entry.distFromPrev)
    .slice(0, topN)
}

/**
 * Enriches a list of raw alert candidates with author and commit-URL metadata
 * by running `git log` and inspecting the `origin` remote.
 */
async function enrichAlerts(
  candidates: Array<{ entry: EvolutionEntry; index: number }>,
  repoPath = '.',
): Promise<EvolutionAlert[]> {
  const remoteUrl = await getRemoteUrl(repoPath)

  const results: EvolutionAlert[] = []
  for (let i = 0; i < candidates.length; i++) {
    const { entry, index } = candidates[i]
    const author = await getCommitAuthor(entry.commitHash, repoPath) ?? undefined
    const commitUrl = remoteUrl ? buildCommitUrl(entry.commitHash, remoteUrl) : undefined

    results.push({
      rank: i + 1,
      index,
      date: formatDate(entry.timestamp),
      blobHash: entry.blobHash,
      commitHash: entry.commitHash,
      distFromPrev: entry.distFromPrev,
      distFromOrigin: entry.distFromOrigin,
      author,
      commitUrl,
    })
  }
  return results
}

/**
 * Renders the top-N alert entries as a human-readable CLI section.
 */
function renderAlerts(alerts: EvolutionAlert[], filePath: string, threshold: number): string {
  if (alerts.length === 0) {
    return `  (no jumps found above threshold ${threshold.toFixed(2)})`
  }

  const lines: string[] = []
  for (const a of alerts) {
    lines.push(`  #${a.rank}  ${a.date}  blob:${shortHash(a.blobHash)}  commit:${shortHash(a.commitHash)}  Δprev=${a.distFromPrev.toFixed(4)}  Δorigin=${a.distFromOrigin.toFixed(4)}`)
    if (a.author) lines.push(`      Author: ${a.author}`)
    if (a.commitUrl) lines.push(`      ${a.commitUrl}`)
  }
  return `⚠  Top ${alerts.length} largest semantic jump${alerts.length === 1 ? '' : 's'} for ${filePath}:\n\n${lines.join('\n')}`
}

/**
 * Serializes evolution entries as a structured JSON object suitable for
 * agent consumption or further processing.
 */
function serializeEvolutionJson(
  filePath: string,
  entries: EvolutionEntry[],
  threshold: number,
  includeContent: boolean,
  originBlob?: string,
  alerts?: EvolutionAlert[],
): string {
  const data: Record<string, unknown> = {
    path: filePath,
    versions: entries.length,
    threshold,
    timeline: entries.map((e, i) => {
      const entry: Record<string, unknown> = {
        index: i,
        date: formatDate(e.timestamp),
        timestamp: e.timestamp,
        blobHash: e.blobHash,
        commitHash: e.commitHash,
        distFromPrev: e.distFromPrev,
        distFromOrigin: e.distFromOrigin,
        isOrigin: originBlob ? e.blobHash === originBlob || e.blobHash.startsWith(originBlob) : i === 0,
        isLargeChange: i > 0 && e.distFromPrev >= threshold,
      }
      if (includeContent) {
        entry.content = getBlobContent(e.blobHash) ?? null
      }
      return entry
    }),
    summary: {
      largeChanges: entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length,
      maxDistFromPrev: entries.length > 0 ? Math.max(...entries.map((e) => e.distFromPrev), 0) : 0,
      totalDrift: entries.length > 0 ? entries[entries.length - 1].distFromOrigin : 0,
    },
  }
  if (alerts !== undefined) {
    data.alerts = alerts
  }
  return JSON.stringify(data, null, 2)
}

/**
 * Renders the semantic evolution timeline for a file as human-readable CLI output.
 *
 * Example:
 *   2021-03-15  a3f9c2d  dist_prev=0.000  dist_origin=0.000  (origin)
 *   2022-06-10  b19e4a1  dist_prev=0.123  dist_origin=0.123
 *   2023-01-05  c02d8f7  dist_prev=0.412  dist_origin=0.389  ← large change
 */
function renderEvolution(
  entries: EvolutionEntry[],
  threshold: number,
  originBlob?: string,
  showHeadings = true,
): string {
  if (entries.length === 0) return '  (no history found — has the file been indexed?)'

  const lines: string[] = []
  if (showHeadings) {
    lines.push(`${'Date'.padEnd(10)}  ${'Blob'.padEnd(11)}  ${'Commit'.padEnd(9)}  ${'Dist_Prev'.padEnd(10)}  Dist_Origin`)
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const date = formatDate(e.timestamp)
    const hash = shortHash(e.blobHash)
    const commitShort = shortHash(e.commitHash)
    const dPrev = e.distFromPrev.toFixed(4)
    const dOrigin = e.distFromOrigin.toFixed(4)
    let note = ''
    if (originBlob && (e.blobHash === originBlob || e.blobHash.startsWith(originBlob))) note = '  (origin)'
    else if (!originBlob && i === 0) note = '  (origin)'
    else if (e.distFromPrev >= threshold) note = '  ← large change'
    lines.push(
      `${date}  blob:${hash}  commit:${commitShort}  dist_prev=${dPrev}  dist_origin=${dOrigin}${note}`,
    )
  }
  return lines.join('\n')
}

export async function evolutionCommand(
  filePath: string,
  options: EvolutionCommandOptions,
): Promise<void> {
  if (!filePath || filePath.trim() === '') {
    console.error('Error: file path is required')
    process.exit(1)
  }

  // Apply CLI model overrides
  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

  const remoteUrl = options.remote ?? process.env.GITSEMA_REMOTE
  if (remoteUrl) {
    process.env.GITSEMA_REMOTE = remoteUrl
    const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.3
    try {
      const result = await remoteFileEvolution(filePath.trim(), {
        threshold,
        includeContent: options.includeContent ?? false,
      })
      const json = JSON.stringify(result, null, 2)
      if (options.dump !== undefined) {
        if (typeof options.dump === 'string') {
          writeFileSync(options.dump, json, 'utf8')
          console.log(`Evolution JSON written to: ${options.dump}`)
        } else {
          process.stdout.write(json + '\n')
          return
        }
      }
      // Human-readable summary from structured data
      const data = result as { path: string; versions: number; timeline: Array<{ date: string; blobHash: string; commitHash: string; distFromPrev: number; distFromOrigin: number; isOrigin: boolean; isLargeChange: boolean }> }
      console.log(`Evolution of: ${data.path}`)
      console.log(`Versions found: ${data.versions}`)
      if (data.timeline.length > 0) {
        console.log('')
        for (const e of data.timeline) {
          const note = e.isOrigin ? '  (origin)' : e.isLargeChange ? '  ← large change' : ''
          console.log(`${e.date}  blob:${e.blobHash.slice(0, 7)}  commit:${e.commitHash.slice(0, 7)}  dist_prev=${e.distFromPrev.toFixed(4)}  dist_origin=${e.distFromOrigin.toFixed(4)}${note}`)
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
  }

  const threshold =
    options.threshold !== undefined ? parseFloat(options.threshold) : 0.3
  if (isNaN(threshold) || threshold < 0 || threshold > 2) {
    console.error('Error: --threshold must be a number between 0 and 2')
    process.exit(1)
  }

  // Parse --alerts option: boolean true → default 5, numeric string → custom count.
  let alertsTopN: number | undefined
  if (options.alerts !== undefined) {
    if (options.alerts === true) {
      alertsTopN = 5
    } else {
      alertsTopN = parseInt(String(options.alerts), 10) || 5
    }
  }

  const includeContent = options.includeContent ?? false
  const origin = options.origin
  let entries = computeEvolution(filePath.trim(), origin, { useSymbolLevel: options.level === 'symbol' })

  // If branch option specified, filter entries to blobs present on that branch
  if (options.branch) {
    const branchSet = getBranchBlobHashSet(options.branch)
    entries = entries.filter((e) => branchSet.has(e.blobHash))
  }

  // Build and enrich alerts when --alerts is set.
  let enrichedAlerts: EvolutionAlert[] | undefined
  if (alertsTopN !== undefined) {
    const candidates = buildAlerts(entries, threshold, alertsTopN)
    enrichedAlerts = await enrichAlerts(candidates)
  }

  // --dump: emit structured JSON to a file or stdout
  if (options.dump !== undefined) {
    const json = serializeEvolutionJson(filePath.trim(), entries, threshold, includeContent, origin, enrichedAlerts)

    if (typeof options.dump === 'string') {
      // --dump <file> → write JSON to file, then print human-readable to stdout
      try {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Evolution JSON written to: ${options.dump}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error writing dump file: ${msg}`)
        process.exit(1)
      }
      // Fall through to also print human-readable summary below
    } else {
      // --dump without a file path → print JSON to stdout and exit
      process.stdout.write(json + '\n')
      return
    }
  }

  // Human-readable output
  console.log(`Evolution of: ${filePath}`)
  if (options.origin) console.log(`Origin blob: ${options.origin}`)
  console.log(`Versions found: ${entries.length}`)

  // --html: emit interactive HTML visualization
  if (options.html !== undefined) {
    const html = renderFileEvolutionHtml(filePath.trim(), entries, threshold)
    const outFile = typeof options.html === 'string' ? options.html : 'file-evolution.html'
    try {
      writeFileSync(outFile, html, 'utf8')
      console.log(`File-evolution HTML written to: ${outFile}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error writing HTML file: ${msg}`)
      process.exit(1)
    }
    return
  }

  if (enrichedAlerts !== undefined) {
    // --alerts mode: show alerts section (optionally in addition to the full timeline)
    console.log('')
    console.log(renderAlerts(enrichedAlerts, filePath, threshold))
  } else if (entries.length > 0) {
    console.log('')
    console.log(renderEvolution(entries, threshold, origin, !options.noHeadings))
  }

  // Phase 56: LLM narration
  if (options.narrate && entries.length > 0) {
    console.log('')
    console.log('=== LLM Evolution Narrative ===')
    const narrative = await narrateEvolution(filePath, entries, threshold)
    console.log(narrative)
  }
}
