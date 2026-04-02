import { writeFileSync } from 'node:fs'
import {
  resolveRefToTimestamp,
  getBlobHashesUpTo,
  computeClusterSnapshot,
  compareClusterSnapshots,
  type TemporalClusterReport,
  type ClusterChange,
} from '../../core/search/clustering.js'
import { renderClusterDiffHtml } from '../../core/viz/htmlRenderer.js'

export interface ClusterDiffCommandOptions {
  k?: string
  top?: string
  iterations?: string
  edgeThreshold?: string
  dump?: string | boolean
  html?: string | boolean
  enhancedLabels?: boolean
  enhancedKeywordsN?: string
}

/**
 * `gitsema cluster-diff <ref1> <ref2>`
 *
 * Computes semantic clusters at two points in history and shows how the
 * concept landscape changed: which blobs are new, removed, or migrated between
 * clusters.
 */
export async function clusterDiffCommand(
  ref1: string,
  ref2: string,
  options: ClusterDiffCommandOptions,
): Promise<void> {
  const k = options.k !== undefined ? parseInt(options.k, 10) : 8
  const top = options.top !== undefined ? parseInt(options.top, 10) : 5
  const iterations = options.iterations !== undefined ? parseInt(options.iterations, 10) : 20
  const edgeThreshold = options.edgeThreshold !== undefined ? parseFloat(options.edgeThreshold) : 0.3
  const useEnhancedLabels = options.enhancedLabels ?? false
  const enhancedKeywordsN = options.enhancedKeywordsN !== undefined ? parseInt(options.enhancedKeywordsN, 10) : 5

  if (isNaN(k) || k < 1) {
    console.error('Error: --k must be a positive integer')
    process.exit(1)
  }

  try {
    // Resolve refs to timestamps
    let ts1 = 0
    let ts2 = 0
    try {
      ts1 = resolveRefToTimestamp(ref1)
    } catch {
      console.error(`Error: cannot resolve ref1 "${ref1}" to a timestamp.`)
      process.exit(1)
    }
    try {
      ts2 = resolveRefToTimestamp(ref2)
    } catch {
      console.error(`Error: cannot resolve ref2 "${ref2}" to a timestamp.`)
      process.exit(1)
    }

    if (ts2 < ts1) {
      console.error('Warning: ref2 is older than ref1. The diff will show blobs removed going backwards in time.')
    }

    // Load blob hashes visible at each ref
    const hashes1 = getBlobHashesUpTo(ts1)
    const hashes2 = getBlobHashesUpTo(ts2)

    if (hashes1.length === 0 && hashes2.length === 0) {
      console.error('No indexed blobs found for either ref. Run `gitsema index` first.')
      process.exit(1)
    }

    // Compute cluster snapshots
    const clusterOpts = { k, maxIterations: iterations, edgeThreshold, topPaths: top, topKeywords: 5, useEnhancedLabels, enhancedKeywordsN }

    const snapshot1 = await computeClusterSnapshot({ ...clusterOpts, blobHashFilter: hashes1 })
    const snapshot2 = await computeClusterSnapshot({ ...clusterOpts, blobHashFilter: hashes2 })

    const report = compareClusterSnapshots(snapshot1, snapshot2, ref1, ref2)

    if (options.dump !== undefined) {
      const json = JSON.stringify(report, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Wrote cluster-diff JSON to ${options.dump}`)
      } else {
        console.log(json)
      }
      return
    }

    if (options.html !== undefined) {
      const html = renderClusterDiffHtml(report)
      const outFile = typeof options.html === 'string' ? options.html : 'cluster-diff.html'
      try {
        writeFileSync(outFile, html, 'utf8')
        console.log(`Wrote cluster-diff HTML to ${outFile}`)
      } catch (err) {
        console.error(`Error writing HTML file: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
      return
    }

    printTemporalReport(report)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function driftLabel(drift: number): string {
  if (drift < 0) return 'n/a'
  if (drift < 0.05) return 'stable'
  if (drift < 0.15) return 'minor shift'
  if (drift < 0.3) return 'moderate shift'
  return 'large shift'
}

function printClusterChange(change: ClusterChange, index: number): void {
  const after = change.afterCluster
  const before = change.beforeCluster

  if (after !== null && before !== null) {
    // Matched pair
    const driftStr = `${change.centroidDrift.toFixed(3)} (${driftLabel(change.centroidDrift)})`
    console.log(`  Cluster ${index + 1}  "${after.label}"  (${after.size} blobs)  ← was "${before.label}"`)
    console.log(`    Centroid drift:  ${driftStr}`)
  } else if (after !== null) {
    // New cluster — no before-match
    console.log(`  Cluster ${index + 1}  "${after.label}"  (${after.size} blobs)  [NEW]`)
  } else if (before !== null) {
    // Dissolved cluster — no after-match
    console.log(`  Cluster "${before.label}"  (${before.size} blobs)  [DISSOLVED]`)
  }

  if (change.stable > 0) console.log(`    Stable blobs:    ${change.stable}`)
  if (change.newBlobs > 0) console.log(`    New blobs:       ${change.newBlobs}`)
  if (change.removedBlobs > 0) console.log(`    Removed blobs:   ${change.removedBlobs}`)

  if (change.inflows.length > 0) {
    const parts = change.inflows.map((f) => `${f.count} from "${f.fromClusterLabel}"`).join(', ')
    console.log(`    Migrated in:     ${parts}`)
  }
  if (change.outflows.length > 0) {
    const parts = change.outflows.map((f) => `${f.count} to "${f.toClusterLabel}"`).join(', ')
    console.log(`    Migrated out:    ${parts}`)
  }

  const topPaths = (after ?? before)!.representativePaths
  if (topPaths.length > 0) {
    console.log(`    Top paths:       ${topPaths.join(', ')}`)
  }
  const keywords = (after ?? before)!.topKeywords
  if (keywords.length > 0) {
    console.log(`    Keywords:        ${keywords.join(', ')}`)
  }
  const enhanced = (after ?? before)!.enhancedKeywords
  if (enhanced.length > 0) {
    console.log(`    Enhanced:        ${enhanced.join(', ')}`)
  }

  console.log('')
}

function printTemporalReport(report: TemporalClusterReport): void {
  console.log(`Temporal cluster diff: ${report.ref1} → ${report.ref2}`)
  console.log(`Before: ${report.before.clusters.length} clusters, ${report.before.totalBlobs} blobs`)
  console.log(`After:  ${report.after.clusters.length} clusters, ${report.after.totalBlobs} blobs`)
  console.log(
    `Changes: ${report.newBlobsTotal} new, ${report.removedBlobsTotal} removed, ` +
    `${report.movedBlobsTotal} moved, ${report.stableBlobsTotal} stable`,
  )
  console.log('')
  console.log('--- Cluster changes ---')
  console.log('')

  report.changes.forEach((change, i) => printClusterChange(change, i))
}
