import { db } from '../db/sqlite.js'
import { embeddings, paths } from '../db/schema.js'
import { inArray, eq } from 'drizzle-orm'
import type { Embedding, SearchResult } from '../models/types.js'
import { filterByTimeRange, getFirstSeenMap, computeRecencyScores } from './timeSearch.js'

/**
 * Computes the cosine similarity between two vectors.
 * Returns a value in [-1, 1]; 1 means identical direction.
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Deserializes a Float32Array stored as a Buffer back to number[].
 */
function bufferToEmbedding(buf: Buffer): Embedding {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

export interface VectorSearchOptions {
  topK?: number
  /** When set, only embeddings produced by this model are considered. */
  model?: string
  /** When true, blends cosine similarity with a recency score. */
  recent?: boolean
  /** Weight for cosine similarity in the blended score (default 0.8). Only used with `recent`. */
  alpha?: number
  /** Only include blobs whose earliest commit is strictly before this Unix timestamp (seconds). */
  before?: number
  /** Only include blobs whose earliest commit is strictly after this Unix timestamp (seconds). */
  after?: number
}

/**
 * Searches the database by embedding all stored vectors against the query
 * vector, then returns the top-k results sorted by cosine similarity (or
 * blended score when `recent` is true). Supports temporal filtering via
 * `before` / `after` Unix timestamps.
 */
export function vectorSearch(queryEmbedding: Embedding, options: VectorSearchOptions = {}): SearchResult[] {
  const { topK = 10, model, recent = false, alpha = 0.8, before, after } = options

  // Load stored embeddings, optionally filtered to a specific model
  const baseQuery = db.select({
    blobHash: embeddings.blobHash,
    vector: embeddings.vector,
  }).from(embeddings)

  const filteredQuery = model ? baseQuery.where(eq(embeddings.model, model)) : baseQuery
  const allRows = filteredQuery.all()

  // Apply time-range filter on the candidate set before scoring
  const allHashes = allRows.map((r) => r.blobHash)
  const filteredHashes = (before !== undefined || after !== undefined)
    ? new Set(filterByTimeRange(allHashes, before, after))
    : null   // null means no filter — include all

  const candidateRows = filteredHashes
    ? allRows.filter((r) => filteredHashes.has(r.blobHash))
    : allRows

  if (candidateRows.length === 0) return []

  // Compute cosine similarity for each candidate blob
  type ScoredBlob = { blobHash: string; cosine: number }
  const scored: ScoredBlob[] = candidateRows.map((row) => ({
    blobHash: row.blobHash,
    cosine: cosineSimilarity(queryEmbedding, bufferToEmbedding(row.vector as Buffer)),
  }))

  // Optionally blend with recency score
  type FinalBlob = { blobHash: string; score: number }
  let finalScored: FinalBlob[]

  if (recent) {
    const candidateHashes = scored.map((s) => s.blobHash)
    const firstSeenMap = getFirstSeenMap(candidateHashes)
    const recencyScores = computeRecencyScores(firstSeenMap)

    finalScored = scored.map((s) => {
      const recency = recencyScores.get(s.blobHash) ?? 0
      return { blobHash: s.blobHash, score: alpha * s.cosine + (1 - alpha) * recency }
    })
  } else {
    finalScored = scored.map((s) => ({ blobHash: s.blobHash, score: s.cosine }))
  }

  // Sort descending by score, take top-k
  finalScored.sort((a, b) => b.score - a.score)
  const topBlobs = finalScored.slice(0, topK)

  if (topBlobs.length === 0) return []

  // Resolve file paths
  const blobHashes = topBlobs.map((b) => b.blobHash)
  const pathRows = db.select({
    blobHash: paths.blobHash,
    path: paths.path,
  }).from(paths).where(inArray(paths.blobHash, blobHashes)).all()

  const pathsByBlob = new Map<string, string[]>()
  for (const row of pathRows) {
    const list = pathsByBlob.get(row.blobHash) ?? []
    list.push(row.path)
    pathsByBlob.set(row.blobHash, list)
  }

  // Resolve firstCommit / firstSeen for the result set
  const firstSeenMap = getFirstSeenMap(blobHashes)

  return topBlobs.map((b) => {
    const firstSeen = firstSeenMap.get(b.blobHash)
    return {
      blobHash: b.blobHash,
      paths: pathsByBlob.get(b.blobHash) ?? [],
      score: b.score,
      firstCommit: firstSeen?.commitHash,
      firstSeen: firstSeen?.timestamp,
    }
  })
}

/**
 * Merges two ranked result lists (from different models) into a single list.
 * When a blob appears in both, the higher score is kept. The final list is
 * re-sorted by score descending and truncated to topK.
 */
export function mergeSearchResults(
  a: SearchResult[],
  b: SearchResult[],
  topK: number,
): SearchResult[] {
  const best = new Map<string, SearchResult>()
  for (const r of [...a, ...b]) {
    const existing = best.get(r.blobHash)
    if (!existing || r.score > existing.score) {
      best.set(r.blobHash, r)
    }
  }
  return Array.from(best.values())
    .sort((x, y) => y.score - x.score)
    .slice(0, topK)
}
