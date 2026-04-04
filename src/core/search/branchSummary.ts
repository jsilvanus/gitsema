import { getActiveSession } from '../db/sqlite.js'
import { cosineSimilarity } from './vectorSearch.js'
import { getMergeBase, getBranchExclusiveBlobs } from '../git/branchDiff.js'
import { computeEvolution } from './evolution.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConceptMatch {
  clusterLabel: string
  /** Cosine similarity between the branch centroid and this cluster's centroid. */
  similarity: number
  topKeywords: string[]
  representativePaths: string[]
}

export interface DriftedPath {
  path: string
  /** Cosine distance of the last version from its predecessor (0 for single-version files). */
  semanticDrift: number
}

export interface BranchSummaryResult {
  branch: string
  baseBranch: string
  mergeBase: string
  exclusiveBlobCount: number
  /** Unweighted mean centroid of the branch-exclusive blob embeddings. */
  branchCentroid: number[]
  /** Top-K nearest existing concept clusters to the branch centroid. */
  nearestConcepts: ConceptMatch[]
  /** Files touched by the branch, sorted by semantic drift descending. */
  topChangedPaths: DriftedPath[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

function meanCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const dim = vectors[0].length
  const centroid = new Array<number>(dim).fill(0)
  for (const v of vectors) {
    for (let d = 0; d < dim; d++) centroid[d] += v[d]
  }
  for (let d = 0; d < dim; d++) centroid[d] /= vectors.length
  return centroid
}

// ---------------------------------------------------------------------------
// computeBranchSummary
// ---------------------------------------------------------------------------

/**
 * Generates a semantic summary of what a branch "is about" compared to its
 * base branch.
 *
 * Steps:
 *  1. Find the merge base between `branch` and `baseBranch`.
 *  2. Determine blob hashes first introduced on the branch since the merge base.
 *  3. Load embeddings and compute the unweighted branch centroid.
 *  4. Find the nearest persisted concept clusters to the branch centroid.
 *  5. Compute semantic drift for each file path touched by the branch.
 *
 * @param branch      Branch to summarise (short name, e.g. "feature/auth").
 * @param baseBranch  Base branch to compare against (default "main").
 * @param opts.topConcepts  Number of nearest concept clusters to return (default 5).
 * @param opts.topPaths     Number of top semantically-drifted paths to return (default 10).
 * @param opts.repoPath     Repository working directory (default ".").
 */
export async function computeBranchSummary(
  branch: string,
  baseBranch = 'main',
  opts: { topConcepts?: number; topPaths?: number; repoPath?: string } = {},
): Promise<BranchSummaryResult> {
  const topConcepts = opts.topConcepts ?? 5
  const topPathsN = opts.topPaths ?? 10
  const repoPath = opts.repoPath ?? '.'

  // 1. Merge base
  const mergeBase = getMergeBase(branch, baseBranch, repoPath)

  // 2. Branch-exclusive blobs
  const exclusiveBlobs = getBranchExclusiveBlobs(branch, mergeBase, repoPath)

  if (exclusiveBlobs.length === 0) {
    return {
      branch,
      baseBranch,
      mergeBase,
      exclusiveBlobCount: 0,
      branchCentroid: [],
      nearestConcepts: [],
      topChangedPaths: [],
    }
  }

  const { rawDb } = getActiveSession()
  const BATCH = 500

  // 3. Load embeddings and paths for exclusive blobs
  const embMap = new Map<string, number[]>()
  const pathsByBlob = new Map<string, string[]>()

  for (let i = 0; i < exclusiveBlobs.length; i += BATCH) {
    const batch = exclusiveBlobs.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')

    const embRows = rawDb
      .prepare(
        `SELECT blob_hash, vector FROM embeddings WHERE blob_hash IN (${placeholders})`,
      )
      .all(...batch) as Array<{ blob_hash: string; vector: Buffer }>
    for (const row of embRows) {
      embMap.set(row.blob_hash, bufferToEmbedding(row.vector))
    }

    const pathRows = rawDb
      .prepare(
        `SELECT DISTINCT blob_hash, path FROM paths WHERE blob_hash IN (${placeholders})`,
      )
      .all(...batch) as Array<{ blob_hash: string; path: string }>
    for (const row of pathRows) {
      const list = pathsByBlob.get(row.blob_hash) ?? []
      list.push(row.path)
      pathsByBlob.set(row.blob_hash, list)
    }
  }

  // 4. Branch centroid
  const vectors = [...embMap.values()]
  const branchCentroid = meanCentroid(vectors)

  // 5. Nearest concept clusters (requires a prior `gitsema clusters` run)
  const clusterRows = rawDb
    .prepare(
      `SELECT id, label, centroid, top_keywords, representative_paths FROM blob_clusters`,
    )
    .all() as Array<{
      id: number
      label: string
      centroid: Buffer
      top_keywords: string
      representative_paths: string
    }>

  const nearestConcepts: ConceptMatch[] = branchCentroid.length > 0
    ? clusterRows
        .map((row) => {
          const centVec = bufferToEmbedding(row.centroid)
          const similarity = cosineSimilarity(branchCentroid, centVec)
          return {
            clusterLabel: row.label,
            similarity,
            topKeywords: JSON.parse(row.top_keywords) as string[],
            representativePaths: JSON.parse(row.representative_paths) as string[],
          }
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topConcepts)
    : []

  // 6. Semantic drift for paths touched by the branch
  const uniquePaths = new Set<string>()
  for (const paths of pathsByBlob.values()) {
    for (const p of paths) uniquePaths.add(p)
  }

  const driftedPaths: DriftedPath[] = []
  for (const p of uniquePaths) {
    const evolution = computeEvolution(p)
    if (evolution.length >= 2) {
      const lastEntry = evolution[evolution.length - 1]
      driftedPaths.push({ path: p, semanticDrift: lastEntry.distFromPrev })
    } else if (evolution.length === 1) {
      // Single-version file — new file added on the branch, drift from origin = 0
      driftedPaths.push({ path: p, semanticDrift: evolution[0].distFromOrigin })
    }
  }
  driftedPaths.sort((a, b) => b.semanticDrift - a.semanticDrift)

  return {
    branch,
    baseBranch,
    mergeBase,
    exclusiveBlobCount: exclusiveBlobs.length,
    branchCentroid,
    nearestConcepts,
    topChangedPaths: driftedPaths.slice(0, topPathsN),
  }
}
