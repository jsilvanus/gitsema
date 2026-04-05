import { getActiveSession } from '../db/sqlite.js'
import { cosineSimilarity, getBranchBlobHashSet } from './vectorSearch.js'
import { resolveRefToTimestamp, getBlobHashesUpTo } from './clustering.js'
import type { Embedding } from '../models/types.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SemanticDiffEntry {
  blobHash: string
  paths: string[]
  /** Cosine similarity to the topic query (higher = more relevant) */
  score: number
  /** Unix timestamp of the earliest commit that contains this blob */
  firstSeen: number
}

export interface SemanticDiffResult {
  ref1: string
  ref2: string
  topic: string
  /** Blobs present at ref2 but not at ref1, scored by topic relevance */
  gained: SemanticDiffEntry[]
  /** Blobs present at ref1 but not at ref2, scored by topic relevance */
  lost: SemanticDiffEntry[]
  /** Blobs present at both refs, scored by topic relevance */
  stable: SemanticDiffEntry[]
  /** Unix timestamp resolved from ref1 */
  timestamp1: number
  /** Unix timestamp resolved from ref2 */
  timestamp2: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Loads embeddings, paths, and first-seen timestamps for the given set of
 * blob hashes.  Blobs without a stored embedding are silently excluded.
 */
function loadBlobData(
  blobHashes: string[],
): Map<string, { vector: number[]; paths: string[]; firstSeen: number }> {
  if (blobHashes.length === 0) return new Map()

  const { rawDb } = getActiveSession()
  const placeholders = blobHashes.map(() => '?').join(',')

  const embRows = rawDb
    .prepare(`SELECT blob_hash, vector FROM embeddings WHERE blob_hash IN (${placeholders})`)
    .all(...blobHashes) as Array<{ blob_hash: string; vector: Buffer }>

  const pathRows = rawDb
    .prepare(
      `SELECT DISTINCT blob_hash, path FROM paths WHERE blob_hash IN (${placeholders})`,
    )
    .all(...blobHashes) as Array<{ blob_hash: string; path: string }>

  const tsRows = rawDb
    .prepare(
      `SELECT bc.blob_hash, MIN(c.timestamp) as first_seen
       FROM blob_commits bc
       JOIN commits c ON bc.commit_hash = c.commit_hash
       WHERE bc.blob_hash IN (${placeholders})
       GROUP BY bc.blob_hash`,
    )
    .all(...blobHashes) as Array<{ blob_hash: string; first_seen: number }>

  const pathMap = new Map<string, string[]>()
  for (const row of pathRows) {
    if (!pathMap.has(row.blob_hash)) pathMap.set(row.blob_hash, [])
    pathMap.get(row.blob_hash)!.push(row.path)
  }

  const tsMap = new Map<string, number>()
  for (const row of tsRows) {
    tsMap.set(row.blob_hash, row.first_seen)
  }

  const result = new Map<string, { vector: number[]; paths: string[]; firstSeen: number }>()
  for (const row of embRows) {
    const f32 = new Float32Array(
      row.vector.buffer,
      row.vector.byteOffset,
      row.vector.byteLength / 4,
    )
    result.set(row.blob_hash, {
      vector: Array.from(f32),
      paths: pathMap.get(row.blob_hash) ?? [],
      firstSeen: tsMap.get(row.blob_hash) ?? 0,
    })
  }
  return result
}

/** Score and sort a set of blobs by cosine similarity to the query. */
function scoreAndSort(
  blobHashes: string[],
  embeddingMap: Map<string, { vector: number[]; paths: string[]; firstSeen: number }>,
  queryEmbedding: Embedding,
  topK: number,
): SemanticDiffEntry[] {
  const scored: SemanticDiffEntry[] = []
  for (const hash of blobHashes) {
    const data = embeddingMap.get(hash)
    if (!data) continue
    const score = cosineSimilarity(queryEmbedding, data.vector)
    scored.push({
      blobHash: hash,
      paths: data.paths,
      score,
      firstSeen: data.firstSeen,
    })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes a conceptual/semantic diff of a topic across two git refs.
 *
 * For each ref, all blobs with an earliest-commit timestamp ≤ the ref's
 * timestamp are considered "present".  A blob is:
 *   - **gained** if it is present at ref2 but not at ref1
 *   - **lost**   if it is present at ref1 but not at ref2
 *   - **stable** if it is present at both refs
 *
 * Each group is then scored by cosine similarity to the topic query and the
 * top-k most relevant entries are returned per group.
 *
 * @param queryEmbedding  Embedding of the topic/query string.
 * @param topic           Human-readable topic description (for display).
 * @param ref1            Earlier git ref (branch, tag, commit, or date).
 * @param ref2            Later git ref.
 * @param topK            Maximum entries to return per group (default 10).
 */
export function computeSemanticDiff(
  queryEmbedding: Embedding,
  topic: string,
  ref1: string,
  ref2: string,
  topK = 10,
  branch?: string,
): SemanticDiffResult {
  const ts1 = resolveRefToTimestamp(ref1)
  const ts2 = resolveRefToTimestamp(ref2)

  let set1 = new Set(getBlobHashesUpTo(ts1))
  let set2 = new Set(getBlobHashesUpTo(ts2))

  // If a branch is provided, intersect both sets with the branch's blob set
  if (branch) {
    const branchSet = getBranchBlobHashSet(branch)
    set1 = new Set([...set1].filter((h) => branchSet.has(h)))
    set2 = new Set([...set2].filter((h) => branchSet.has(h)))
  }

  const gainedHashes = [...set2].filter((h) => !set1.has(h))
  const lostHashes = [...set1].filter((h) => !set2.has(h))
  const stableHashes = [...set1].filter((h) => set2.has(h))

  // Load embeddings for the union of all blobs we need to score
  const allHashes = [...new Set([...set1, ...set2])]
  const embeddingMap = loadBlobData(allHashes)

  return {
    ref1,
    ref2,
    topic,
    timestamp1: ts1,
    timestamp2: ts2,
    gained: scoreAndSort(gainedHashes, embeddingMap, queryEmbedding, topK),
    lost: scoreAndSort(lostHashes, embeddingMap, queryEmbedding, topK),
    stable: scoreAndSort(stableHashes, embeddingMap, queryEmbedding, topK),
  }
}
