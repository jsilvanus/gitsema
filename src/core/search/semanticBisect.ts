/**
 * Semantic Git Bisect — binary search over commit history to find where a
 * concept changed most relative to a "good" baseline.
 */
import { execFileSync } from 'node:child_process'
import { getActiveSession } from '../db/sqlite.js'
import type { Embedding } from '../models/types.js'
import { resolveRefToTimestamp, getBlobHashesUpTo } from './clustering.js'
import { cosineSimilarity, vectorNorm } from './vectorSearch.js'

export interface BisectStep {
  ref: string
  timestamp: number
  blobCount: number
  centroid: number[] | null
  distanceFromGood: number
}

export interface BisectResult {
  goodRef: string
  badRef: string
  query: string
  culpritTimestamp: number
  culpritRef: string
  steps: BisectStep[]
  goodCentroid: number[] | null
  maxShift: number
}

export interface BisectOptions {
  topK?: number
  repoPath?: string
  maxSteps?: number
}

/**
 * Compute the centroid of the top-K vectors that match queryEmbedding,
 * restricted to blob hashes in `blobHashes`.
 */
function computeConceptCentroid(
  queryEmbedding: Embedding,
  blobHashes: string[],
  topK: number,
): number[] | null {
  if (blobHashes.length === 0) return null
  const { rawDb } = getActiveSession()
  const placeholders = blobHashes.map(() => '?').join(',')
  const rows = rawDb.prepare(
    `SELECT blob_hash, vector FROM embeddings WHERE blob_hash IN (${placeholders}) LIMIT 5000`
  ).all(...blobHashes) as Array<{ blob_hash: string; vector: Buffer }>

  if (rows.length === 0) return null

  // Score each blob
  type Scored = { vec: number[]; score: number }
  const scored: Scored[] = rows.map((r) => {
    const vec = Array.from(new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4))
    return { vec, score: cosineSimilarity(queryEmbedding, vec) }
  })
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, topK)

  const dim = top[0].vec.length
  const centroid = new Array<number>(dim).fill(0)
  for (const { vec } of top) {
    for (let i = 0; i < dim; i++) centroid[i] += vec[i]
  }
  for (let i = 0; i < dim; i++) centroid[i] /= top.length
  return centroid
}

function centroidDistance(a: number[] | null, b: number[] | null): number {
  if (!a || !b) return 1
  return 1 - cosineSimilarity(a, b)
}

/**
 * Get all commit timestamps between goodTs and badTs from the DB.
 */
function getCommitTimestampsBetween(goodTs: number, badTs: number): number[] {
  const { rawDb } = getActiveSession()
  const rows = rawDb.prepare(
    `SELECT DISTINCT timestamp FROM commits WHERE timestamp > ? AND timestamp <= ? ORDER BY timestamp ASC`
  ).all(goodTs, badTs) as Array<{ timestamp: number }>
  return rows.map((r) => r.timestamp)
}

export function computeSemanticBisect(
  queryEmbedding: Embedding,
  query: string,
  goodRef: string,
  badRef: string,
  options: BisectOptions = {},
): BisectResult {
  const { topK = 20, repoPath = '.', maxSteps = 10 } = options

  const goodTs = resolveRefToTimestamp(goodRef, repoPath)
  const badTs = resolveRefToTimestamp(badRef, repoPath)

  if (goodTs >= badTs) {
    throw new Error(`"good" ref (${goodRef}) must be earlier than "bad" ref (${badRef})`)
  }

  const goodBlobs = getBlobHashesUpTo(goodTs)
  const goodCentroid = computeConceptCentroid(queryEmbedding, goodBlobs, topK)

  const allTimestamps = getCommitTimestampsBetween(goodTs, badTs)
  
  const steps: BisectStep[] = []

  // Binary search over timestamp range
  let lo = 0
  let hi = allTimestamps.length - 1
  let culpritTs = badTs
  let maxShift = 0

  for (let step = 0; step < maxSteps && lo <= hi; step++) {
    const mid = Math.floor((lo + hi) / 2)
    const ts = allTimestamps[mid]
    const blobs = getBlobHashesUpTo(ts)
    const centroid = computeConceptCentroid(queryEmbedding, blobs, topK)
    const dist = centroidDistance(goodCentroid, centroid)

    steps.push({
      ref: `~${new Date(ts * 1000).toISOString().slice(0, 10)}`,
      timestamp: ts,
      blobCount: blobs.length,
      centroid,
      distanceFromGood: dist,
    })

    if (dist > 0.1) {
      // Significant divergence — culprit is in lower half
      culpritTs = ts
      if (dist > maxShift) maxShift = dist
      hi = mid - 1
    } else {
      // Still close to good — culprit is in upper half
      lo = mid + 1
    }
  }

  return {
    goodRef,
    badRef,
    query,
    culpritTimestamp: culpritTs,
    culpritRef: new Date(culpritTs * 1000).toISOString().slice(0, 10),
    steps,
    goodCentroid,
    maxShift,
  }
}
