import { writeFileSync } from 'node:fs'
import { computeMergeImpact } from '../../core/search/mergeAudit.js'
import {
  type TemporalClusterReport,
  type ClusterChange,
} from '../../core/search/clustering.js'
import { renderClusterDiffHtml } from '../../core/viz/htmlRenderer.js'

export interface MergePreviewCommandOptions {
  into?: string
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
 * `gitsema merge-preview <branch>`
 *
 * Predicts how the semantic concept landscape will shift after merging
 * `branch` into a target branch.  Reuses the cluster-diff infrastructure
 * (compareClusterSnapshots) with branch-filtered blob sets instead of
 * timestamp-filtered sets.
 */
export async function mergePreviewCommand(
  branch: string,
  options: MergePreviewCommandOptions,
): Promise<void> {
  const baseBranch = options.into ?? 'main'
  const k = options.k !== undefined ? parseInt(options.k, 10) : 8
  const top = options.top !== undefined ? parseInt(options.top, 10) : 5
  const iterations = options.iterations !== undefined ? parseInt(options.iterations, 10) : 20
  const edgeThreshold =
    options.edgeThreshold !== undefined ? parseFloat(options.edgeThreshold) : 0.3
  const useEnhancedLabels = options.enhancedLabels ?? false
  const enhancedKeywordsN =
    options.enhancedKeywordsN !== undefined ? parseInt(options.enhancedKeywordsN, 10) : 5

  if (isNaN(k) || k < 1) {
    console.error('Error: --k must be a positive integer')
    process.exit(1)
  }

  try {
    const report = await computeMergeImpact(branch, baseBranch, {
      k,
      maxIterations: iterations,
      edgeThreshold,
      topPaths: top,
      topKeywords: 5,
      useEnhancedLabels,
      enhancedKeywordsN,
    })

    if (options.dump !== undefined) {
      const json = JSON.stringify(report, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Wrote merge-preview JSON to ${options.dump}`)
      } else {
        console.log(json)
      }
      return
    }

    if (options.html !== undefined) {
      const html = renderClusterDiffHtml(report)
      const outFile =
        typeof options.html === 'string' ? options.html : 'merge-preview.html'
      try {
        writeFileSync(outFile, html, 'utf8')
        console.log(`Wrote merge-preview HTML to ${outFile}`)
      } catch (err) {
        console.error(
          `Error writing HTML file: ${err instanceof Error ? err.message : String(err)}`,
        )
        process.exit(1)
      }
      return
    }

    printReport(report, branch, baseBranch)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Human-readable output (adapted from clusterDiff.ts)
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
    const driftStr = `${change.centroidDrift.toFixed(3)} (${driftLabel(change.centroidDrift)})`
    console.log(
      `  Cluster ${index + 1}  "${after.label}"  (${after.size} blobs)  ← was "${before.label}"`,
    )
    console.log(`    Centroid drift:  ${driftStr}`)
  } else if (after !== null) {
    console.log(
      `  Cluster ${index + 1}  "${after.label}"  (${after.size} blobs)  [NEW]`,
    )
  } else if (before !== null) {
    console.log(
      `  Cluster "${before.label}"  (${before.size} blobs)  [DISSOLVED after merge]`,
    )
  }

  if (change.stable > 0) console.log(`    Stable blobs:    ${change.stable}`)
  if (change.newBlobs > 0) console.log(`    New blobs:       ${change.newBlobs}`)
  if (change.removedBlobs > 0) console.log(`    Removed blobs:   ${change.removedBlobs}`)

  if (change.inflows.length > 0) {
    const parts = change.inflows
      .map((f) => `${f.count} from "${f.fromClusterLabel}"`)
      .join(', ')
    console.log(`    Migrated in:     ${parts}`)
  }
  if (change.outflows.length > 0) {
    const parts = change.outflows
      .map((f) => `${f.count} to "${f.toClusterLabel}"`)
      .join(', ')
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

function printReport(
  report: TemporalClusterReport,
  branch: string,
  baseBranch: string,
): void {
  console.log(`Merge preview: ${branch} → ${baseBranch}`)
  console.log(`  Base branch blobs:   ${report.before.totalBlobs}`)
  console.log(`  Post-merge blobs:    ${report.after.totalBlobs}`)
  console.log(
    `  Changes: ${report.newBlobsTotal} new, ${report.removedBlobsTotal} removed, ` +
      `${report.movedBlobsTotal} moved, ${report.stableBlobsTotal} stable`,
  )
  console.log('')
  console.log('--- Predicted cluster changes after merge ---')
  console.log('')

  if (report.changes.length === 0) {
    console.log('  No cluster changes predicted.')
    return
  }

  report.changes.forEach((change, i) => printClusterChange(change, i))
}
