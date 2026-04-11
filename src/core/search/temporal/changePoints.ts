import { getActiveSession } from '../../db/sqlite.js'
import { cosineSimilarity, getBranchBlobHashSet } from '../core/vectorSearch.js'
import { computeEvolution } from '../evolution.js'
import { bufferToFloat32 as bufferToEmbedding } from '../../../utils/embedding.js'
import type { Embedding } from '../../models/types.js'

function cosineDistance(a: Embedding, b: Embedding): number {
  return 1 - cosineSimilarity(a, b)
}

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
    candidateHashes?: string[]
  } = {},
): ConceptChangePointReport {
  const topK = opts.topK ?? 50
  const threshold = opts.threshold ?? 0.3
  const topPoints = opts.topPoints ?? 5
  const sinceLabel = opts.since ? new Date(opts.since * 1000).toISOString().slice(0, 10) : null
  const untilLabel = opts.until ? new Date(opts.until * 1000).toISOString().slice(0, 10) : null

  const { rawDb } = getActiveSession()

  let embRows = rawDb
    .prepare('SELECT blob_hash, vector FROM embeddings')
    .all() as Array<{ blob_hash: string; vector: Buffer }>

  if (embRows.length === 0) {
    return { type: 'concept-change-points', query, k: topK, threshold, range: { since: sinceLabel, until: untilLabel }, points: [] }
  }

  if (opts.branch) {
    embRows = rawDb.prepare('SELECT blob_hash, vector FROM embeddings WHERE blob_hash IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ?)').all(opts.branch) as Array<{ blob_hash: string; vector: Buffer }>
    if (embRows.length === 0) {
      return { type: 'concept-change-points', query, k: topK, threshold, range: { since: sinceLabel, until: untilLabel }, points: [] }
    }
  }

  if (opts.candidateHashes && opts.candidateHashes.length > 0) {
    const candSet = new Set(opts.candidateHashes)
    embRows = embRows.filter((r) => candSet.has(r.blob_hash))
    if (embRows.length === 0) {
      return { type: 'concept-change-points', query, k: topK, threshold, range: { since: sinceLabel, until: untilLabel }, points: [] }
    }
  }

  const scoredBlobs = embRows.map((r) => ({
    blobHash: r.blob_hash,
    emb: bufferToEmbedding(r.vector),
    score: cosineSimilarity(queryEmbedding, bufferToEmbedding(r.vector)),
  }))

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

  const blobsWithMeta = scoredBlobs
    .map((b) => {
      const info = firstSeenMap.get(b.blobHash)
      if (!info) return null
      return { ...b, firstSeen: info.timestamp, paths: pathsByBlob.get(b.blobHash) ?? [] }
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.firstSeen - b.firstSeen)

  const sortedByScore = [...blobsWithMeta].sort((a, b) => b.score - a.score)

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

  let blobPtr = 0
  const visibleSet = new Set<string>()
  let prevCentroid: Float32Array | null = null
  let prevCommit: { commit_hash: string; timestamp: number } | null = null
  let prevTopPaths: string[] = []

  const allChangePoints: ConceptChangePoint[] = []

  for (const commit of commitRows) {
    while (blobPtr < blobsWithMeta.length && blobsWithMeta[blobPtr].firstSeen <= commit.timestamp) {
      visibleSet.add(blobsWithMeta[blobPtr].blobHash)
      blobPtr++
    }

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

export function computeFileChangePoints(
  filePath: string,
  opts: {
    threshold?: number
    topPoints?: number
    since?: number
    until?: number
    useSymbolLevel?: boolean
    branch?: string
  } = {},
): FileChangePointReport {
  const threshold = opts.threshold ?? 0.3
  const topPoints = opts.topPoints ?? 5
  const sinceLabel = opts.since ? new Date(opts.since * 1000).toISOString().slice(0, 10) : null
  const untilLabel = opts.until ? new Date(opts.until * 1000).toISOString().slice(0, 10) : null

  let entries = computeEvolution(filePath, undefined, { useSymbolLevel: opts.useSymbolLevel })

  if (opts.branch) {
    const branchSet = getBranchBlobHashSet(opts.branch)
    entries = entries.filter((e) => branchSet.has(e.blobHash))
  }

  const allChangePoints: FileChangePoint[] = []

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]
    const curr = entries[i]

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
