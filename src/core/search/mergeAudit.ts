import { getActiveSession } from '../db/sqlite.js'
import { cosineSimilarity } from './vectorSearch.js'
import { getMergeBase, getBranchExclusiveBlobs } from '../git/branchDiff.js'
import {
  computeClusterSnapshot,
  compareClusterSnapshots,
  getBlobHashesUpTo,
  resolveRefToTimestamp,
  type TemporalClusterReport,
} from './clustering.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CollisionBlobEntry {
  hash: string
  paths: string[]
  /** Cosine similarity to its counterpart in the pair. */
  score: number
}

export interface CollisionPair {
  blobA: CollisionBlobEntry
  blobB: CollisionBlobEntry
  /** Cosine similarity between the two blobs. */
  similarity: number
  /**
   * Cluster label when both blobs belong to the same cluster in the persisted
   * cluster_assignments table.  Undefined when the table is empty or blobs are
   * in different clusters.
   */
  clusterLabel?: string
}

export interface CollisionZone {
  clusterLabel: string
  pairCount: number
  /** Up to 6 representative paths from both blobs in the zone. */
  topPaths: string[]
}

export interface SemanticCollisionReport {
  branchA: string
  branchB: string
  mergeBase: string
  /** Number of exclusive blobs on branch A (before filtering to collisions). */
  blobCountA: number
  /** Number of exclusive blobs on branch B (before filtering to collisions). */
  blobCountB: number
  /** Top-K collision pairs sorted by similarity descending. */
  collisionPairs: CollisionPair[]
  /** Groups of collisions by semantic concept cluster. */
  collisionZones: CollisionZone[]
  /**
   * Cosine similarity between the mean centroid of branch A blobs and branch B
   * blobs.  High positive value (> 0.7) means the branches worked on related
   * concepts.  -1 when either branch has no exclusive blobs.
   */
  centroidSimilarity: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

/** Computes the unweighted mean centroid of a list of embedding vectors. */
export function meanCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const dim = vectors[0].length
  const centroid = new Array<number>(dim).fill(0)
  for (const v of vectors) {
    for (let d = 0; d < dim; d++) centroid[d] += v[d]
  }
  for (let d = 0; d < dim; d++) centroid[d] /= vectors.length
  return centroid
}

/** Loads embeddings and paths for a set of blob hashes in batches. */
export function loadBlobData(
  blobHashes: string[],
): Map<string, { vector: number[]; paths: string[] }> {
  if (blobHashes.length === 0) return new Map()
  const { rawDb } = getActiveSession()
  const BATCH = 500
  const embMap = new Map<string, number[]>()
  const pathMap = new Map<string, string[]>()

  for (let i = 0; i < blobHashes.length; i += BATCH) {
    const batch = blobHashes.slice(i, i + BATCH)
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
      const list = pathMap.get(row.blob_hash) ?? []
      list.push(row.path)
      pathMap.set(row.blob_hash, list)
    }
  }

  const result = new Map<string, { vector: number[]; paths: string[] }>()
  for (const [hash, vector] of embMap) {
    result.set(hash, { vector, paths: pathMap.get(hash) ?? [] })
  }
  return result
}

/** Loads cluster assignments (blob_hash → cluster_id) for a set of blobs. */
function loadClusterAssignments(blobHashes: string[]): Map<string, number> {
  if (blobHashes.length === 0) return new Map()
  const { rawDb } = getActiveSession()
  const BATCH = 500
  const result = new Map<string, number>()
  for (let i = 0; i < blobHashes.length; i += BATCH) {
    const batch = blobHashes.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')
    const rows = rawDb
      .prepare(
        `SELECT blob_hash, cluster_id FROM cluster_assignments WHERE blob_hash IN (${placeholders})`,
      )
      .all(...batch) as Array<{ blob_hash: string; cluster_id: number }>
    for (const row of rows) result.set(row.blob_hash, row.cluster_id)
  }
  return result
}

/** Loads the label for a cluster_id from blob_clusters. */
function loadClusterLabel(clusterId: number): string | undefined {
  const { rawDb } = getActiveSession()
  const row = rawDb
    .prepare(`SELECT label FROM blob_clusters WHERE id = ?`)
    .get(clusterId) as { label: string } | undefined
  return row?.label
}

// ---------------------------------------------------------------------------
// computeSemanticCollisions
// ---------------------------------------------------------------------------

/**
 * Detects semantic collisions between two sets of branch-exclusive blobs.
 *
 * Two blobs "collide" when their cosine similarity exceeds `threshold`.  This
 * surfaces cases where both branches modified code about the same concept
 * (e.g. "authentication") even at entirely different file paths — something
 * that textual Git diff cannot detect.
 *
 * The algorithm is O(|blobsA| × |blobsB|) — fast for typical feature branches
 * (tens of files).
 *
 * @param blobsA     Indexed blob hashes exclusive to branch A.
 * @param blobsB     Indexed blob hashes exclusive to branch B.
 * @param branchA    Branch A name (for display).
 * @param branchB    Branch B name (for display).
 * @param mergeBase  Merge-base commit hash (for display).
 * @param opts.threshold  Cosine similarity threshold for a collision (default 0.85).
 * @param opts.topK       Maximum collision pairs to return (default 20).
 */
export function computeSemanticCollisions(
  blobsA: string[],
  blobsB: string[],
  branchA: string,
  branchB: string,
  mergeBase: string,
  opts: { threshold?: number; topK?: number } = {},
): SemanticCollisionReport {
  const threshold = opts.threshold ?? 0.85
  const topK = opts.topK ?? 20

  const dataA = loadBlobData(blobsA)
  const dataB = loadBlobData(blobsB)

  // Centroid-level branch overlap score
  const vectorsA = [...dataA.values()].map((d) => d.vector)
  const vectorsB = [...dataB.values()].map((d) => d.vector)
  const centroidA = meanCentroid(vectorsA)
  const centroidB = meanCentroid(vectorsB)
  const centroidSimilarity =
    centroidA.length > 0 && centroidB.length > 0
      ? cosineSimilarity(centroidA, centroidB)
      : -1

  // Find collision pairs: O(|A| × |B|)
  const allPairs: Array<{ hashA: string; hashB: string; similarity: number }> = []
  for (const [hashA, dA] of dataA) {
    for (const [hashB, dB] of dataB) {
      const sim = cosineSimilarity(dA.vector, dB.vector)
      if (sim >= threshold) {
        allPairs.push({ hashA, hashB, similarity: sim })
      }
    }
  }
  allPairs.sort((a, b) => b.similarity - a.similarity)
  const topPairs = allPairs.slice(0, topK)

  // Load cluster assignments for all colliding blobs
  const collidingHashes = [
    ...new Set([...topPairs.map((p) => p.hashA), ...topPairs.map((p) => p.hashB)]),
  ]
  const clusterAssignments = loadClusterAssignments(collidingHashes)

  // Build CollisionPair objects
  const collisionPairs: CollisionPair[] = topPairs.map((p) => {
    const dA = dataA.get(p.hashA)!
    const dB = dataB.get(p.hashB)!
    const cidA = clusterAssignments.get(p.hashA)
    const cidB = clusterAssignments.get(p.hashB)
    let clusterLabel: string | undefined
    if (cidA !== undefined && cidA === cidB) {
      clusterLabel = loadClusterLabel(cidA)
    }
    return {
      blobA: { hash: p.hashA, paths: dA.paths, score: p.similarity },
      blobB: { hash: p.hashB, paths: dB.paths, score: p.similarity },
      similarity: p.similarity,
      clusterLabel,
    }
  })

  // Build collision zones grouped by cluster
  const zoneMap = new Map<string, { pairCount: number; pathSet: Set<string> }>()
  for (const pair of collisionPairs) {
    const label = pair.clusterLabel
    if (!label) continue
    if (!zoneMap.has(label)) zoneMap.set(label, { pairCount: 0, pathSet: new Set() })
    const zone = zoneMap.get(label)!
    zone.pairCount++
    for (const p of [...pair.blobA.paths, ...pair.blobB.paths]) zone.pathSet.add(p)
  }

  const collisionZones: CollisionZone[] = Array.from(zoneMap.entries())
    .map(([clusterLabel, z]) => ({
      clusterLabel,
      pairCount: z.pairCount,
      topPaths: [...z.pathSet].slice(0, 6),
    }))
    .sort((a, b) => b.pairCount - a.pairCount)

  return {
    branchA,
    branchB,
    mergeBase,
    blobCountA: blobsA.length,
    blobCountB: blobsB.length,
    collisionPairs,
    collisionZones,
    centroidSimilarity,
  }
}

// ---------------------------------------------------------------------------
// computeMergeImpact
// ---------------------------------------------------------------------------

/**
 * Predicts the semantic cluster shift that will occur after merging `branch`
 * into `baseBranch`.
 *
 * Computes cluster snapshots for:
 *  - **before**: the current base branch (blobs visible up to its tip timestamp)
 *  - **after**:  the predicted post-merge state (base blobs ∪ branch-exclusive blobs)
 *
 * Returns a `TemporalClusterReport` — identical in structure to what
 * `cluster-diff` produces, so zero new types are required.
 */
export async function computeMergeImpact(
  branch: string,
  baseBranch: string,
  opts: {
    repoPath?: string
    k?: number
    maxIterations?: number
    edgeThreshold?: number
    topPaths?: number
    topKeywords?: number
    useEnhancedLabels?: boolean
    enhancedKeywordsN?: number
  } = {},
): Promise<TemporalClusterReport> {
  const repoPath = opts.repoPath ?? '.'

  // 1. Resolve merge base
  const mergeBase = getMergeBase(branch, baseBranch, repoPath)

  // 2. Base branch blobs (temporal — same strategy as cluster-diff)
  const baseBranchTs = resolveRefToTimestamp(baseBranch, repoPath)
  const baseBranchBlobs = getBlobHashesUpTo(baseBranchTs)

  // 3. Branch-exclusive blobs
  const branchExclusive = getBranchExclusiveBlobs(branch, mergeBase, repoPath)

  // 4. Post-merge blob set (deduplicated union)
  const afterBlobs = [...new Set([...baseBranchBlobs, ...branchExclusive])]

  const clusterOpts = {
    k: opts.k,
    maxIterations: opts.maxIterations,
    edgeThreshold: opts.edgeThreshold,
    topPaths: opts.topPaths,
    topKeywords: opts.topKeywords,
    useEnhancedLabels: opts.useEnhancedLabels,
    enhancedKeywordsN: opts.enhancedKeywordsN,
  }

  // 5. Cluster snapshots (computed in parallel)
  const [snapshotBefore, snapshotAfter] = await Promise.all([
    computeClusterSnapshot({ ...clusterOpts, blobHashFilter: baseBranchBlobs }),
    computeClusterSnapshot({ ...clusterOpts, blobHashFilter: afterBlobs }),
  ])

  // 6. Compare and return — reuses compareClusterSnapshots verbatim
  return compareClusterSnapshots(snapshotBefore, snapshotAfter, baseBranch, branch)
}
