import { writeFileSync } from 'node:fs'
import { computeEvolution } from '../../core/search/evolution.js'
import { formatDate, shortHash } from '../../core/search/ranking.js'
import { getBlobContent } from '../../core/indexing/blobStore.js'
import type { EvolutionEntry } from '../../core/search/evolution.js'

export interface EvolutionCommandOptions {
  threshold?: string
  dump?: string | boolean
  includeContent?: boolean
  origin?: string
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
): string {
  const data = {
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
): string {
  if (entries.length === 0) return '  (no history found — has the file been indexed?)'

  const lines: string[] = []
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

  const threshold =
    options.threshold !== undefined ? parseFloat(options.threshold) : 0.3
  if (isNaN(threshold) || threshold < 0 || threshold > 2) {
    console.error('Error: --threshold must be a number between 0 and 2')
    process.exit(1)
  }

  const includeContent = options.includeContent ?? false
  const origin = options.origin
  const entries = computeEvolution(filePath.trim(), origin)

  // --dump: emit structured JSON to a file or stdout
  if (options.dump !== undefined) {
    const json = serializeEvolutionJson(filePath.trim(), entries, threshold, includeContent, origin)

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
  if (entries.length > 0) {
    console.log('')
    console.log(renderEvolution(entries, threshold, origin))
  }
}
