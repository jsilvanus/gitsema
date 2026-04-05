import { getActiveSession } from '../db/sqlite.js'
import { cosineSimilarity, getBranchBlobHashSet } from './vectorSearch.js'
import { computeEvolution } from './evolution.js'
import type { Embedding } from '../models/types.js'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bufferToEmbedding(buf: Buffer): Float32Array {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return f32
}

function cosineDistance(a: Embedding, b: Embedding): number {
  return 1 - cosineSimilarity(a, b)
}

/**
 * Computes a weighted centroid of the given embeddings.
 * Weights are cosine similarity scores (higher = more representative).
 * Returns an empty Float32Array when embs is empty (callers must guard before use).
 */
function weightedCentroid(embs: (number[] | Float32Array)[], weights: number[]): Float32Array {
  if (embs.length === 0) return new Float32Array(0)
  const dim = embs[0].length
  const centroid = new Float32Array(dim)
  let totalWeight = 0
  for (let i = 0; i < embs.length; i++) {
    totalWeight += weights[i]
    for (let d = 0; d < dim; d++) {
      centroid[d] += embs[i][d] * weights[i]
    }
  }
  if (totalWeight === 0) return centroid
  for (let d = 0; d < dim; d++) centroid[d] /= totalWeight
  return centroid
}

// ---------------------------------------------------------------------------
// Concept change points
// ---------------------------------------------------------------------------

export interface ConceptChangePoint {
  before: {
    commit: string
    date: string
    timestamp: number
    topPaths: string[]
  }
  after: {
    commit: string
    date: string
    timestamp: number
    topPaths: string[]
  }
  distance: number
}

export interface ConceptChangePointReport {
  type: 'concept-change-points'
  query: string
  k: number
  threshold: number
  range: { since: string | null; until: string | null }
  points: ConceptChangePoint[]
}

/**
 * Detects semantic change points for a concept query across Git history.
 *
 * For each indexed commit in chronological order the function:
 *  1. Determines which blobs were visible as of that commit (first-seen <= commit timestamp).
 *  2. Takes the top-k visible blobs by cosine similarity with the query.
 *  3. Computes a weighted centroid (weights = similarity scores) for those k blobs.
 *  4. Measures the cosine distance between consecutive centroids.
 *  5. Emits a change point when that distance >= threshold.
 *
 * Returns the top `topPoints` change points sorted by distance descending.
 */
export function computeConceptChangePoints(
  query: string,
  queryEmbedding: Embedding,
  opts: {
    topK?: number
    threshold?: number
    topPoints?: number
    since?: number
    until?: number
    branch?: string
  } = {},
): ConceptChangePointReport {
  const topK = opts.topK ?? 50
  const threshold = opts.threshold ?? 0.3
  const topPoints = opts.topPoints ?? 5
  const sinceLabel = opts.since ? new Date(opts.since * 1000).toISOString().slice(0, 10) : null
  const untilLabel = opts.until ? new Date(opts.until * 1000).toISOString().slice(0, 10) : null

  const { rawDb } = getActiveSession()

  // --- Load all embeddings and pre-score against the query ---
  let embRows = rawDb
    .prepare('SELECT blob_hash, vector FROM embeddings')
    .all() as Array<{ blob_hash: string; vector: Buffer }>

  if (embRows.length === 0) {
    return { type: 'concept-change-points', query, k: topK, threshold, range: { since: sinceLabel, until: untilLabel }, points: [] }
  }

  // Apply branch filter at SQL level when requested
  if (opts.branch) {
    // Use rawDb prepare with IN via a subquery on blob_branches
    embRows = rawDb.prepare('SELECT blob_hash, vector FROM embeddings WHERE blob_hash IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ?)').all(opts.branch) as Array<{ blob_hash: string; vector: Buffer }>
    if (embRows.length === 0) {
      return { type: 'concept-change-points', query, k: topK, threshold, range: { since: sinceLabel, until: untilLabel }, points: [] }
    }
  }

  const scoredBlobs = embRows.map((r) => ({
    blobHash: r.blob_hash,
    emb: bufferToEmbedding(r.vector),
    score: cosineSimilarity(queryEmbedding, bufferToEmbedding(r.vector)),
  }))

  // --- Get first-seen info per blob ---
  const blobHashes = embRows.map((r) => r.blob_hash)
  const BATCH = 500
  const firstSeenMap = new Map<string, { timestamp: number; commitHash: string }>()
  for (let i = 0; i < blobHashes.length; i += BATCH) {
    const batch = blobHashes.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')
    const rows = rawDb.prepare(`
      SELECT bc.blob_hash, MIN(c.timestamp) AS min_ts, c.commit_hash
      FROM blob_commits bc
      JOIN commits c ON bc.commit_hash = c.commit_hash
      WHERE bc.blob_hash IN (${placeholders})
      GROUP BY bc.blob_hash
    `).all(...batch) as Array<{ blob_hash: string; min_ts: number; commit_hash: string }>
    for (const row of rows) {
      const existing = firstSeenMap.get(row.blob_hash)
      if (!existing || row.min_ts < existing.timestamp) {
        firstSeenMap.set(row.blob_hash, { timestamp: row.min_ts, commitHash: row.commit_hash })
      }
    }
  }

  // --- Get file paths for all blobs ---
  const pathsByBlob = new Map<string, string[]>()
  for (let i = 0; i < blobHashes.length; i += BATCH) {
    const batch = blobHashes.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')
    const pathRows = rawDb.prepare(`
      SELECT blob_hash, path FROM paths WHERE blob_hash IN (${placeholders})
    `).all(...batch) as Array<{ blob_hash: string; path: string }>
    for (const row of pathRows) {
      const list = pathsByBlob.get(row.blob_hash) ?? []
      list.push(row.path)
      pathsByBlob.set(row.blob_hash, list)
    }
  }

  // --- Attach metadata and sort by first-seen (for pointer advance) ---
  const blobsWithMeta = scoredBlobs
    .map((b) => {
      const info = firstSeenMap.get(b.blobHash)
      if (!info) return null
      return { ...b, firstSeen: info.timestamp, paths: pathsByBlob.get(b.blobHash) ?? [] }
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.firstSeen - b.firstSeen)

  // Pre-sort by score descending for efficient top-k selection
  const sortedByScore = [...blobsWithMeta].sort((a, b) => b.score - a.score)

  // --- Get all commits in chronological order, optionally filtered ---
  const conditions: string[] = []
  const params: number[] = []
  if (opts.since !== undefined) { conditions.push('timestamp >= ?'); params.push(opts.since) }
  if (opts.until !== undefined) { conditions.push('timestamp <= ?'); params.push(opts.until) }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const commitRows = rawDb.prepare(
    `SELECT commit_hash, timestamp FROM commits ${whereClause} ORDER BY timestamp ASC`
  ).all(...params) as Array<{ commit_hash: string; timestamp: number }>

  if (commitRows.length < 2) {
    return { type: 'concept-change-points', query, k: topK, threshold, range: { since: sinceLabel, until: untilLabel }, points: [] }
  }

  // --- Process commits in chronological order ---
  let blobPtr = 0
  const visibleSet = new Set<string>()
  let prevCentroid: Float32Array | null = null
  let prevCommit: { commit_hash: string; timestamp: number } | null = null
  let prevTopPaths: string[] = []

  const allChangePoints: ConceptChangePoint[] = []

  for (const commit of commitRows) {
    // Advance pointer: add blobs that first appeared at or before this commit
    while (blobPtr < blobsWithMeta.length && blobsWithMeta[blobPtr].firstSeen <= commit.timestamp) {
      visibleSet.add(blobsWithMeta[blobPtr].blobHash)
      blobPtr++
    }

    // Select top-k visible blobs from the score-sorted list
    const topKBlobs: typeof blobsWithMeta = []
    for (const b of sortedByScore) {
      if (visibleSet.has(b.blobHash)) {
        topKBlobs.push(b)
        if (topKBlobs.length >= topK) break
      }
    }

    if (topKBlobs.length === 0) {
      prevCommit = commit
      continue
    }

    const centroid = weightedCentroid(
      topKBlobs.map((b) => b.emb),
      topKBlobs.map((b) => b.score),
    )
    const topPaths = topKBlobs.flatMap((b) => b.paths).slice(0, 5)

    if (prevCentroid !== null && prevCommit !== null) {
      const distance = cosineDistance(prevCentroid, centroid)
      if (distance >= threshold) {
        allChangePoints.push({
          before: {
            commit: prevCommit.commit_hash,
            date: new Date(prevCommit.timestamp * 1000).toISOString().slice(0, 10),
            timestamp: prevCommit.timestamp,
            topPaths: prevTopPaths,
          },
          after: {
            commit: commit.commit_hash,
            date: new Date(commit.timestamp * 1000).toISOString().slice(0, 10),
            timestamp: commit.timestamp,
            topPaths,
          },
          distance,
        })
      }
    }

    prevCentroid = centroid
    prevCommit = commit
    prevTopPaths = topPaths
  }

  allChangePoints.sort((a, b) => b.distance - a.distance)
  return {
    type: 'concept-change-points',
    query,
    k: topK,
    threshold,
    range: { since: sinceLabel, until: untilLabel },
    points: allChangePoints.slice(0, topPoints),
  }
}

// ---------------------------------------------------------------------------
// File change points
// ---------------------------------------------------------------------------

export interface FileChangePoint {
  before: {
    commit: string
    date: string
    timestamp: number
    blobHash: string
  }
  after: {
    commit: string
    date: string
    timestamp: number
    blobHash: string
  }
  distance: number
}

export interface FileChangePointReport {
  type: 'file-change-points'
  path: string
  threshold: number
  range: { since: string | null; until: string | null }
  points: FileChangePoint[]
}

/**
 * Detects semantic change points in a single file's history.
 *
 * Reuses `computeEvolution` to retrieve consecutive-version cosine distances
 * and emits a change point for every pair where the distance >= threshold.
 * Returns the top `topPoints` change points sorted by distance descending.
 */
export function computeFileChangePoints(
  filePath: string,
  opts: {
    threshold?: number
    topPoints?: number
    since?: number
    until?: number
    useSymbolLevel?: boolean
  } = {},
): FileChangePointReport {
  const threshold = opts.threshold ?? 0.3
  const topPoints = opts.topPoints ?? 5
  const sinceLabel = opts.since ? new Date(opts.since * 1000).toISOString().slice(0, 10) : null
  const untilLabel = opts.until ? new Date(opts.until * 1000).toISOString().slice(0, 10) : null

  const entries = computeEvolution(filePath, undefined, { useSymbolLevel: opts.useSymbolLevel })

  const allChangePoints: FileChangePoint[] = []

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]
    const curr = entries[i]

    // Filter by since/until on the "after" entry timestamp
    if (opts.since !== undefined && curr.timestamp < opts.since) continue
    if (opts.until !== undefined && curr.timestamp > opts.until) continue

    if (curr.distFromPrev >= threshold) {
      allChangePoints.push({
        before: {
          commit: prev.commitHash,
          date: new Date(prev.timestamp * 1000).toISOString().slice(0, 10),
          timestamp: prev.timestamp,
          blobHash: prev.blobHash,
        },
        after: {
          commit: curr.commitHash,
          date: new Date(curr.timestamp * 1000).toISOString().slice(0, 10),
          timestamp: curr.timestamp,
          blobHash: curr.blobHash,
        },
        distance: curr.distFromPrev,
      })
    }
  }

  allChangePoints.sort((a, b) => b.distance - a.distance)
  return {
    type: 'file-change-points',
    path: filePath,
    threshold,
    range: { since: sinceLabel, until: untilLabel },
    points: allChangePoints.slice(0, topPoints),
  }
}
