import { writeFileSync } from 'node:fs'
import {
  computeClusterChangePoints,
  resolveRefToTimestamp,
  type ClusterChangePointReport,
  type ClusterChangePoint,
} from '../../core/search/clustering.js'
import { renderClusterChangePointsHtml } from '../../core/viz/htmlRenderer.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface ClusterChangePointsCommandOptions {
  k?: string
  threshold?: string
  topPoints?: string
  since?: string
  until?: string
  maxCommits?: string
  dump?: string | boolean
  html?: string | boolean
  enhancedLabels?: boolean
  enhancedKeywordsN?: string
  branch?: string
  out?: string[]
}

function renderClusterChangePoint(point: ClusterChangePoint, rank: number): string {
  const lines: string[] = []
  lines.push(
    `  #${rank}  ${point.before.ref} → ${point.after.ref}  shift=${point.shiftScore.toFixed(4)}`,
  )

  // Show top-moving cluster pairs
  if (point.topMovingPairs.length > 0) {
    const pairStr = point.topMovingPairs
      .map((p) => `"${p.beforeLabel}" → "${p.afterLabel}" (${p.drift.toFixed(3)})`)
      .join(', ')
    lines.push(`       top moves: ${pairStr}`)
  }

  // Before cluster summary
  const beforeSummary = point.before.clusters
    .map((c) => `"${c.label}" (${c.size})`)
    .join(', ')
  lines.push(`       before (${point.before.clusters.length} clusters): ${beforeSummary}`)

  // After cluster summary
  const afterSummary = point.after.clusters
    .map((c) => `"${c.label}" (${c.size})`)
    .join(', ')
  lines.push(`       after  (${point.after.clusters.length} clusters): ${afterSummary}`)

  return lines.join('\n')
}

function renderReport(report: ClusterChangePointReport): string {
  const lines: string[] = []

  lines.push(`Range: ${report.range.since} → ${report.range.until}`)
  lines.push(`k=${report.k}  threshold=${report.threshold}`)
  lines.push('')

  if (report.points.length === 0) {
    lines.push(`  (no change points found above threshold ${report.threshold})`)
    return lines.join('\n')
  }

  lines.push(`Top ${report.points.length} cluster change point(s):`)
  lines.push('')
  for (let i = 0; i < report.points.length; i++) {
    lines.push(renderClusterChangePoint(report.points[i], i + 1))
    lines.push('')
  }
  return lines.join('\n')
}

export async function clusterChangePointsCommand(
  options: ClusterChangePointsCommandOptions,
): Promise<void> {
  const k = options.k !== undefined ? parseInt(options.k, 10) : 8
  if (isNaN(k) || k < 1) {
    console.error('Error: --k must be a positive integer')
    process.exit(1)
  }

  const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.3
  if (isNaN(threshold) || threshold < 0 || threshold > 2) {
    console.error('Error: --threshold must be a number between 0 and 2')
    process.exit(1)
  }

  const topPoints = options.topPoints !== undefined ? parseInt(options.topPoints, 10) : 5
  if (isNaN(topPoints) || topPoints < 1) {
    console.error('Error: --top-points must be a positive integer')
    process.exit(1)
  }

  let maxCommits: number | undefined
  if (options.maxCommits !== undefined) {
    maxCommits = parseInt(options.maxCommits, 10)
    if (isNaN(maxCommits) || maxCommits < 2) {
      console.error('Error: --max-commits must be an integer >= 2')
      process.exit(1)
    }
  }

  let since: number | undefined
  let until: number | undefined

  if (options.since !== undefined) {
    try {
      since = resolveRefToTimestamp(options.since)
    } catch {
      console.error(`Error: cannot resolve --since "${options.since}" to a timestamp.`)
      process.exit(1)
    }
  }
  if (options.until !== undefined) {
    try {
      until = resolveRefToTimestamp(options.until)
    } catch {
      console.error(`Error: cannot resolve --until "${options.until}" to a timestamp.`)
      process.exit(1)
    }
  }

  try {
    const report = await computeClusterChangePoints({
      k,
      threshold,
      topPoints,
      since,
      until,
      maxCommits,
      useEnhancedLabels: options.enhancedLabels ?? false,
      enhancedKeywordsN: options.enhancedKeywordsN !== undefined ? parseInt(options.enhancedKeywordsN, 10) : 5,
      branch: options.branch,
    })

    if (report.range.since === '' && report.range.until === '') {
      console.log('No indexed commits found. Run `gitsema index` first.')
      return
    }

    const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: options.html })
    const jsonSink = getSink(sinks, 'json')
    const htmlSink = getSink(sinks, 'html')

    if (jsonSink) {
      const json = JSON.stringify(report, null, 2)
      if (jsonSink.file) {
        writeFileSync(jsonSink.file, json, 'utf8')
        console.log(`Cluster change points JSON written to: ${jsonSink.file}`)
      } else {
        process.stdout.write(json + '\n')
        return
      }
      if (!hasSinkFormat(sinks, 'text') && !hasSinkFormat(sinks, 'html')) return
    }

    if (htmlSink) {
      const html = renderClusterChangePointsHtml(report)
      if (htmlSink.file) {
        writeFileSync(htmlSink.file, html, 'utf8')
        console.log(`Cluster change points HTML written to: ${htmlSink.file}`)
      } else {
        process.stdout.write(html + '\n')
      }
      if (!hasSinkFormat(sinks, 'text')) return
    }

    console.log('Cluster change points')
    console.log(renderReport(report))
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
