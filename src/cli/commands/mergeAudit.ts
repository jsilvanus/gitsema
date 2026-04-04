import { writeFileSync } from 'node:fs'
import { getMergeBase, getBranchExclusiveBlobs } from '../../core/git/branchDiff.js'
import {
  computeSemanticCollisions,
  type SemanticCollisionReport,
  type CollisionPair,
} from '../../core/search/mergeAudit.js'

export interface MergeAuditCommandOptions {
  base?: string
  threshold?: string
  top?: string
  dump?: string | boolean
}

/**
 * `gitsema merge-audit <branch-a> <branch-b>`
 *
 * Detects semantic collisions between two branches: file pairs that touch the
 * same concept (high cosine similarity) even when they don't share lines.
 */
export async function mergeAuditCommand(
  branchA: string,
  branchB: string,
  options: MergeAuditCommandOptions,
): Promise<void> {
  const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.85
  const topK = options.top !== undefined ? parseInt(options.top, 10) : 20

  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    console.error('Error: --threshold must be a number between 0 and 1')
    process.exit(1)
  }
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  try {
    // Resolve merge base (allow override via --base)
    let mergeBase: string
    if (options.base) {
      mergeBase = options.base
    } else {
      try {
        mergeBase = getMergeBase(branchA, branchB)
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}\n` +
            `Tip: pass --base <commit> to override merge-base detection.`,
        )
        process.exit(1)
      }
    }

    // Branch-exclusive blobs
    const blobsA = getBranchExclusiveBlobs(branchA, mergeBase)
    const blobsB = getBranchExclusiveBlobs(branchB, mergeBase)

    if (blobsA.length === 0 && blobsB.length === 0) {
      console.error(
        'No indexed blobs found on either branch. Run `gitsema index` first.',
      )
      process.exit(1)
    }

    const report = computeSemanticCollisions(blobsA, blobsB, branchA, branchB, mergeBase, {
      threshold,
      topK,
    })

    if (options.dump !== undefined) {
      const json = JSON.stringify(report, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Wrote merge-audit JSON to ${options.dump}`)
      } else {
        console.log(json)
      }
      return
    }

    printReport(report, threshold)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function similarityLabel(sim: number): string {
  if (sim >= 0.95) return 'CRITICAL'
  if (sim >= 0.90) return 'HIGH'
  if (sim >= 0.85) return 'MEDIUM'
  return 'LOW'
}

function centroidOverlapLabel(sim: number): string {
  if (sim < 0) return 'n/a (no exclusive blobs)'
  if (sim >= 0.85) return 'VERY HIGH — branches working on nearly identical concepts'
  if (sim >= 0.70) return 'HIGH — branches working on overlapping concepts'
  if (sim >= 0.50) return 'MODERATE — some conceptual overlap'
  return 'LOW — branches are semantically distinct'
}

function printPair(pair: CollisionPair, index: number): void {
  const pathA = pair.blobA.paths[0] ?? pair.blobA.hash.slice(0, 7)
  const pathB = pair.blobB.paths[0] ?? pair.blobB.hash.slice(0, 7)
  const label = similarityLabel(pair.similarity)
  console.log(
    `  ${index + 1}. [${label}] similarity: ${pair.similarity.toFixed(3)}`,
  )
  console.log(`     ↳ ${pathA}`)
  console.log(`     ↳ ${pathB}`)
  if (pair.clusterLabel) {
    console.log(`        (cluster: ${pair.clusterLabel})`)
  }
}

function printReport(report: SemanticCollisionReport, threshold: number): void {
  console.log(`Merge audit: ${report.branchA} ↔ ${report.branchB}`)
  console.log(`Merge base:  ${report.mergeBase.slice(0, 8)}`)
  console.log(`  Branch A exclusive blobs: ${report.blobCountA}  (${report.branchA})`)
  console.log(`  Branch B exclusive blobs: ${report.blobCountB}  (${report.branchB})`)
  console.log(
    `  Indexed blobs in A / B with embeddings may differ from exclusive blob count`,
  )
  console.log('')
  console.log(
    `Branch centroid similarity: ${report.centroidSimilarity >= 0 ? report.centroidSimilarity.toFixed(3) : 'n/a'} — ${centroidOverlapLabel(report.centroidSimilarity)}`,
  )
  console.log('')

  if (report.collisionPairs.length === 0) {
    console.log(
      `No semantic collisions detected at threshold ${threshold.toFixed(2)}.`,
    )
    console.log(
      'The two branches appear to have worked on independent concepts.',
    )
    return
  }

  console.log(
    `Semantic collisions found: ${report.collisionPairs.length}  (threshold: ${threshold.toFixed(2)})`,
  )
  console.log('')

  if (report.collisionZones.length > 0) {
    console.log('Collision zones (by concept cluster):')
    for (const zone of report.collisionZones) {
      console.log(`  "${zone.clusterLabel}" — ${zone.pairCount} pair(s)`)
      for (const p of zone.topPaths.slice(0, 4)) {
        console.log(`    • ${p}`)
      }
    }
    console.log('')
  }

  console.log('Top collision pairs:')
  report.collisionPairs.forEach((pair, i) => printPair(pair, i))
}
