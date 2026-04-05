/**
 * Concept Lifecycle Analysis — track the birth, growth, maturity, decline, and
 * death of a semantic concept across Git history.
 */
import { getActiveSession } from '../db/sqlite.js'
import type { Embedding } from '../models/types.js'
import { getBlobHashesUpTo } from './clustering.js'
import { cosineSimilarity } from './vectorSearch.js'

export type LifecycleStage = 'born' | 'growing' | 'mature' | 'declining' | 'dead' | 'unknown'

export interface LifecyclePoint {
  timestamp: number
  date: string
  matchCount: number
  growthRate: number
  stage: LifecycleStage
}

export interface ConceptLifecycleResult {
  query: string
  points: LifecyclePoint[]
  currentStage: LifecycleStage
  peakTimestamp: number
  peakCount: number
  bornTimestamp?: number
  /** True if concept appears to no longer be active at HEAD. */
  isDead: boolean
  steps: number
}

export interface ConceptLifecycleOptions {
  topK?: number
  threshold?: number
  steps?: number
  branch?: string
}

function countMatchingBlobs(queryEmbedding: Embedding, blobHashes: string[], threshold: number): number {
  if (blobHashes.length === 0) return 0
  const { rawDb } = getActiveSession()
  const placeholders = blobHashes.map(() => '?').join(',')
  const rows = rawDb.prepare(
    `SELECT blob_hash, vector FROM embeddings WHERE blob_hash IN (${placeholders}) AND (quantized = 0 OR quantized IS NULL) LIMIT 2000`
  ).all(...blobHashes) as Array<{ blob_hash: string; vector: Buffer }>

  let count = 0
  for (const r of rows) {
    const vec = new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4)
    if (cosineSimilarity(queryEmbedding, vec) >= threshold) count++
  }
  return count
}

function classifyStage(prevCount: number, currCount: number, peakCount: number): LifecycleStage {
  if (currCount === 0) return prevCount > 0 ? 'dead' : 'unknown'
  const growthRate = prevCount > 0 ? (currCount - prevCount) / prevCount : 1
  const maturityRatio = currCount / Math.max(peakCount, 1)
  if (prevCount === 0 && currCount > 0) return 'born'
  if (growthRate > 0.1) return 'growing'
  if (growthRate < -0.15) return maturityRatio < 0.5 ? 'declining' : 'declining'
  return 'mature'
}

export function computeConceptLifecycle(
  queryEmbedding: Embedding,
  query: string,
  options: ConceptLifecycleOptions = {},
): ConceptLifecycleResult {
  const { threshold = 0.7, steps = 10, branch } = options
  const { rawDb } = getActiveSession()

  // Get time range from DB
  const timeRange = rawDb.prepare(
    `SELECT MIN(c.timestamp) as minTs, MAX(c.timestamp) as maxTs
     FROM commits c JOIN blob_commits bc ON c.commit_hash = bc.commit_hash`
  ).get() as { minTs: number | null; maxTs: number | null }

  if (!timeRange.minTs || !timeRange.maxTs) {
    return {
      query,
      points: [],
      currentStage: 'unknown',
      peakTimestamp: 0,
      peakCount: 0,
      isDead: false,
      steps: 0,
    }
  }

  const minTs = timeRange.minTs
  const maxTs = timeRange.maxTs
  const step = Math.floor((maxTs - minTs) / Math.max(steps - 1, 1))
  const timestamps = Array.from({ length: steps }, (_, i) => minTs + i * step)
  if (timestamps[timestamps.length - 1] < maxTs) timestamps.push(maxTs)

  const counts: number[] = []
  for (const ts of timestamps) {
    const blobs = getBlobHashesUpTo(ts)
    counts.push(countMatchingBlobs(queryEmbedding, blobs, threshold))
  }

  const peakCount = Math.max(...counts)
  const peakIdx = counts.indexOf(peakCount)

  const points: LifecyclePoint[] = timestamps.map((ts, i) => {
    const prev = i > 0 ? counts[i - 1] : 0
    const curr = counts[i]
    const growthRate = prev > 0 ? (curr - prev) / prev : (curr > 0 ? 1 : 0)
    const stage = classifyStage(prev, curr, peakCount)
    return {
      timestamp: ts,
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      matchCount: curr,
      growthRate,
      stage,
    }
  })

  const bornIdx = counts.findIndex((c) => c > 0)
  const lastCount = counts[counts.length - 1]
  const isDead = peakCount > 0 && lastCount === 0
  const currentStage = points[points.length - 1]?.stage ?? 'unknown'

  return {
    query,
    points,
    currentStage,
    peakTimestamp: timestamps[peakIdx],
    peakCount,
    bornTimestamp: bornIdx >= 0 ? timestamps[bornIdx] : undefined,
    isDead,
    steps: timestamps.length,
  }
}
