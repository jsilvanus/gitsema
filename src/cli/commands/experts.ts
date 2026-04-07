import { writeFileSync } from 'node:fs'
import { computeExperts, type Expert } from '../../core/search/experts.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { parsePositiveInt } from '../../utils/parse.js'

export interface ExpertsCommandOptions {
  top?: string
  since?: string
  until?: string
  minBlobs?: string
  topClusters?: string
  dump?: string | boolean
  html?: string | boolean
}

export async function expertsCommand(options: ExpertsCommandOptions): Promise<void> {
  // ── Parse options ─────────────────────────────────────────────────────────
  let topN = 10
  try {
    topN = parsePositiveInt(options.top ?? '10', '--top')
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  let topClusters = 5
  try {
    topClusters = parsePositiveInt(options.topClusters ?? '5', '--top-clusters')
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  let minBlobs = 1
  try {
    minBlobs = parsePositiveInt(options.minBlobs ?? '1', '--min-blobs')
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  let since: number | undefined
  if (options.since) {
    try {
      since = parseDateArg(options.since)
    } catch {
      console.error(`Error: invalid --since value: "${options.since}". Use YYYY-MM-DD or ISO 8601.`)
      process.exit(1)
    }
  }

  let until: number | undefined
  if (options.until) {
    try {
      until = parseDateArg(options.until)
    } catch {
      console.error(`Error: invalid --until value: "${options.until}". Use YYYY-MM-DD or ISO 8601.`)
      process.exit(1)
    }
  }

  // ── Compute ───────────────────────────────────────────────────────────────
  let experts: Expert[] = []
  try {
    experts = computeExperts({ topN, since, until, minBlobs, topClusters })
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  // ── Output: JSON dump ─────────────────────────────────────────────────────
  if (options.dump !== undefined) {
    const payload = {
      generatedAt: new Date().toISOString(),
      since: since ? new Date(since * 1000).toISOString() : null,
      until: until ? new Date(until * 1000).toISOString() : null,
      experts,
    }
    const json = JSON.stringify(payload, null, 2)
    if (typeof options.dump === 'string' && options.dump !== '') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`Experts JSON written to ${options.dump}`)
    } else {
      console.log(json)
    }
    return
  }

  // ── Output: HTML ──────────────────────────────────────────────────────────
  if (options.html !== undefined) {
    const { renderExpertsHtml } = await import('../../core/viz/htmlRenderer.js')
    const html = renderExpertsHtml(experts, { since, until })
    const outFile = typeof options.html === 'string' && options.html !== '' ? options.html : 'experts.html'
    writeFileSync(outFile, html, 'utf8')
    console.log(`Experts HTML written to: ${outFile}`)
    return
  }

  // ── Output: human-readable text ───────────────────────────────────────────
  if (experts.length === 0) {
    console.log('No contributor data found. Make sure the index has been built (gitsema index).')
    return
  }

  const timeRange = [
    since ? `since ${new Date(since * 1000).toISOString().slice(0, 10)}` : '',
    until ? `until ${new Date(until * 1000).toISOString().slice(0, 10)}` : '',
  ].filter(Boolean).join(', ')

  console.log(`\nTop ${experts.length} contributor${experts.length !== 1 ? 's' : ''} by semantic area${timeRange ? ` (${timeRange})` : ''}\n`)

  for (let i = 0; i < experts.length; i++) {
    const e = experts[i]
    const rank = i + 1
    const emailPart = e.authorEmail ? ` <${e.authorEmail}>` : ''
    console.log(`${rank}. ${e.authorName}${emailPart}`)
    console.log(`   Blobs: ${e.blobCount}`)

    if (e.clusters.length > 0) {
      console.log('   Semantic areas:')
      for (const c of e.clusters) {
        const pathHint = c.representativePaths.length > 0 ? `  (${c.representativePaths.slice(0, 2).join(', ')})` : ''
        console.log(`     · ${c.label}  [${c.blobCount} blob${c.blobCount !== 1 ? 's' : ''}]${pathHint}`)
      }
    } else {
      console.log('   Semantic areas: (no cluster data — run `gitsema clusters` first)')
    }
    console.log()
  }
}
