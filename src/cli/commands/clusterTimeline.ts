import { writeFileSync } from 'node:fs'
import {
  resolveRefToTimestamp,
  computeClusterTimeline,
  type ClusterTimelineReport,
  type ClusterTimelineStep,
  type ClusterChange,
} from '../../core/search/clustering.js'
import { renderClusterTimelineHtml } from '../../core/viz/htmlRenderer.js'

export interface ClusterTimelineCommandOptions {
  k?: string
  steps?: string
  since?: string
  until?: string
  top?: string
  iterations?: string
  edgeThreshold?: string
  threshold?: string
  dump?: string | boolean
  html?: string | boolean
  enhancedLabels?: boolean
  enhancedKeywordsN?: string
}

/**
 * `gitsema cluster-timeline`
 *
 * Walks the indexed commit history at N evenly-spaced checkpoints and shows
 * how semantic clusters shifted (and were relabeled) over time.
 */
export async function clusterTimelineCommand(options: ClusterTimelineCommandOptions): Promise<void> {
  const k = options.k !== undefined ? parseInt(options.k, 10) : 8
  const steps = options.steps !== undefined ? parseInt(options.steps, 10) : 5
  const top = options.top !== undefined ? parseInt(options.top, 10) : 5
  const iterations = options.iterations !== undefined ? parseInt(options.iterations, 10) : 20
  const edgeThreshold = options.edgeThreshold !== undefined ? parseFloat(options.edgeThreshold) : 0.3
  const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.15
  const useEnhancedLabels = options.enhancedLabels ?? false
  const enhancedKeywordsN = options.enhancedKeywordsN !== undefined ? parseInt(options.enhancedKeywordsN, 10) : 5

  if (isNaN(k) || k < 1) {
    console.error('Error: --k must be a positive integer')
    process.exit(1)
  }
  if (isNaN(steps) || steps < 1) {
    console.error('Error: --steps must be a positive integer')
    process.exit(1)
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
    const report: ClusterTimelineReport = await computeClusterTimeline({
      k,
      steps,
      since,
      until,
      maxIterations: iterations,
      edgeThreshold,
      topPaths: top,
      topKeywords: 5,
      useEnhancedLabels,
      enhancedKeywordsN,
    })

    if (report.steps.length === 0) {
      console.log('No indexed commits found. Run `gitsema index` first.')
      return
    }

    if (options.dump !== undefined) {
      const json = JSON.stringify(report, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Wrote cluster-timeline JSON to ${options.dump}`)
      } else {
        console.log(json)
      }
      return
    }

    if (options.html !== undefined) {
      const html = renderClusterTimelineHtml(report, threshold)
      const outFile = typeof options.html === 'string' ? options.html : 'cluster-timeline.html'
      try {
        writeFileSync(outFile, html, 'utf8')
        console.log(`Wrote cluster-timeline HTML to ${outFile}`)
      } catch (err) {
        console.error(`Error writing HTML file: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
      return
    }

    printTimelineReport(report, threshold)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function driftLabel(drift: number): string {
  // Thresholds mirror the cluster-diff command: <0.05 stable, 0.05–0.15 minor, 0.15–0.3 moderate, ≥0.3 large.
  if (drift < 0) return 'n/a'
  if (drift < 0.05) return 'stable'
  if (drift < 0.15) return 'minor shift'
  if (drift < 0.3) return 'moderate shift'
  return 'large shift'
}

function printTimelineReport(report: ClusterTimelineReport, relabelThreshold: number): void {
  const sinceStr = new Date(report.since * 1000).toISOString().slice(0, 10)
  const untilStr = new Date(report.until * 1000).toISOString().slice(0, 10)

  console.log(`Cluster timeline: ${sinceStr} → ${untilStr}`)
  console.log(`  ${report.steps.length} steps, k=${report.k}`)
  console.log('')

  for (let i = 0; i < report.steps.length; i++) {
    const step = report.steps[i]
    printStep(step, i + 1, report.steps.length, relabelThreshold)
  }
}

function printStep(
  step: ClusterTimelineStep,
  stepNum: number,
  totalSteps: number,
  relabelThreshold: number,
): void {
  // Header line
  const blobDelta = step.stats !== null
    ? ` (+${step.stats.newBlobs} new, -${step.stats.removedBlobs} removed)`
    : ''
  console.log(`── Step ${stepNum}/${totalSteps}  ${step.ref}  (${step.blobCount} blobs${blobDelta}) ──`)

  if (step.stats !== null) {
    console.log(
      `   Changes: ${step.stats.newBlobs} new  ${step.stats.removedBlobs} removed  ` +
      `${step.stats.movedBlobs} moved  ${step.stats.stableBlobs} stable`,
    )
  }
  console.log('')

  for (let ci = 0; ci < step.clusters.length; ci++) {
    const c = step.clusters[ci]

    // Find the matching change entry for this cluster
    const change = step.changes?.find((ch) => ch.afterCluster?.id === c.id) ?? null

    let statusStr = ''
    if (change !== null && change.afterCluster !== null && change.beforeCluster !== null) {
      const drift = change.centroidDrift
      const dStr = driftLabel(drift)
      if (drift >= relabelThreshold && change.afterCluster.label !== change.beforeCluster.label) {
        statusStr = `  ← RELABELED from "${change.beforeCluster.label}" (drift ${drift.toFixed(3)}, ${dStr})`
      } else {
        statusStr = `  (drift ${drift.toFixed(3)}, ${dStr})`
      }
    } else if (change !== null && change.beforeCluster === null) {
      statusStr = '  [NEW]'
    }

    console.log(`  #${ci + 1}  "${c.label}"  — ${c.size} blobs${statusStr}`)

    if (c.topKeywords.length > 0) {
      console.log(`       Keywords:  ${c.topKeywords.join(', ')}`)
    }
    if (c.enhancedKeywords.length > 0) {
      console.log(`       Enhanced:  ${c.enhancedKeywords.join(', ')}`)
    }
    if (c.representativePaths.length > 0) {
      console.log(`       Paths:     ${c.representativePaths.join(', ')}`)
    }

    // Show migration summary
    if (change !== null && change.inflows.length > 0) {
      const parts = change.inflows.map((f) => `${f.count} from "${f.fromClusterLabel}"`).join(', ')
      console.log(`       Migrated in: ${parts}`)
    }
    if (change !== null && change.outflows.length > 0) {
      const parts = change.outflows.map((f) => `${f.count} to "${f.toClusterLabel}"`).join(', ')
      console.log(`       Migrated out: ${parts}`)
    }

    console.log('')
  }

  // Dissolved clusters (those that existed in previous step but not in this one)
  if (step.changes !== null) {
    const dissolved = step.changes.filter((ch) => ch.afterCluster === null && ch.beforeCluster !== null)
    for (const ch of dissolved) {
      console.log(`  [DISSOLVED]  "${ch.beforeCluster!.label}"  (was ${ch.beforeCluster!.size} blobs)`)
      console.log('')
    }
  }
}
