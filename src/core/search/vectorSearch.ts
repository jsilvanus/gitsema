import { db } from '../db/sqlite.js'
import { embeddings, paths } from '../db/schema.js'
import { inArray, eq } from 'drizzle-orm'
import type { Embedding, SearchResult } from '../models/types.js'

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
}

/**
 * Searches the database by embedding all stored vectors against the query
 * vector, then returns the top-k results sorted by cosine similarity.
 */
export function vectorSearch(queryEmbedding: Embedding, options: VectorSearchOptions = {}): SearchResult[] {
  const { topK = 10, model } = options

  // Load stored embeddings, optionally filtered to a specific model
  const baseQuery = db.select({
    blobHash: embeddings.blobHash,
    vector: embeddings.vector,
  }).from(embeddings)

  const filteredQuery = model ? baseQuery.where(eq(embeddings.model, model)) : baseQuery
  const rows = filteredQuery.all()

  // Score each blob
  type ScoredBlob = { blobHash: string; score: number }
  const scored: ScoredBlob[] = rows.map((row) => ({
    blobHash: row.blobHash,
    score: cosineSimilarity(queryEmbedding, bufferToEmbedding(row.vector as Buffer)),
  }))

  // Sort descending by score, take top-k
  scored.sort((a, b) => b.score - a.score)
  const topBlobs = scored.slice(0, topK)

  if (topBlobs.length === 0) return []

  // Resolve file paths for each blob using an SQL filter
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

  return topBlobs.map((b) => ({
    blobHash: b.blobHash,
    paths: pathsByBlob.get(b.blobHash) ?? [],
    score: b.score,
  }))
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
