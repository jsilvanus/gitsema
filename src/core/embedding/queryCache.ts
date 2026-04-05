/**
 * Query embedding cache (Phase 18).
 *
 * Stores query string + model → embedding vector in the `query_embeddings` table.
 * Avoids re-calling the embedding provider for repeated identical queries.
 *
 * Cache key: (query_text, model) — different models are stored independently.
 * TTL:        GITSEMA_QUERY_CACHE_TTL_DAYS (default 7 days)
 * Size cap:   GITSEMA_QUERY_CACHE_MAX_ENTRIES (default 10 000)
 */

import { getActiveSession } from '../db/sqlite.js'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
const DEFAULT_MAX_ENTRIES = 10_000

/**
 * Returns the cached embedding for (queryText, model), or null if not cached.
 */
export function getCachedQueryEmbedding(queryText: string, model: string): Float32Array | null {
  const { rawDb } = getActiveSession()
  const row = rawDb
    .prepare('SELECT vector FROM query_embeddings WHERE query_text = ? AND model = ?')
    .get(queryText, model) as { vector: Buffer } | undefined
  if (!row) return null
  const f32 = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4)
  return f32
}

/**
 * Stores (or updates) the embedding for (queryText, model) in the cache.
 * Uses INSERT OR REPLACE so repeat calls with the same key refresh the TTL.
 */
export function setCachedQueryEmbedding(
  queryText: string,
  model: string,
  embedding: Float32Array | number[],
): void {
  const { rawDb } = getActiveSession()
  const vector = embedding instanceof Float32Array
    ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
    : Buffer.from(new Float32Array(embedding).buffer)
  rawDb
    .prepare(
      `INSERT INTO query_embeddings (query_text, model, dimensions, vector, cached_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (query_text, model) DO UPDATE SET
         vector = excluded.vector,
         dimensions = excluded.dimensions,
         cached_at = excluded.cached_at`,
    )
    .run(queryText, model, (embedding as any).length, vector, Date.now())
}

/**
 * Removes expired entries and enforces the size cap.
 *
 * @param maxEntries  Maximum number of entries to retain (default 10 000).
 * @param ttlMs       Entry lifetime in milliseconds (default 7 days).
 * @returns Number of entries removed.
 */
export function pruneQueryEmbeddingCache(
  maxEntries = DEFAULT_MAX_ENTRIES,
  ttlMs = DEFAULT_TTL_MS,
): number {
  const { rawDb } = getActiveSession()

  // 1. Delete TTL-expired entries
  const cutoff = Date.now() - ttlMs
  const { changes: expiredCount } = rawDb
    .prepare('DELETE FROM query_embeddings WHERE cached_at < ?')
    .run(cutoff)

  // 2. Cap at maxEntries by removing oldest entries beyond the limit
  const { c: count } = rawDb
    .prepare('SELECT COUNT(*) as c FROM query_embeddings')
    .get() as { c: number }

  let capCount = 0
  if (count > maxEntries) {
    const excess = count - maxEntries
    const { changes } = rawDb
      .prepare(
        'DELETE FROM query_embeddings WHERE id IN ' +
        '(SELECT id FROM query_embeddings ORDER BY cached_at ASC LIMIT ?)',
      )
      .run(excess)
    capCount = changes
  }

  return (expiredCount as number) + capCount
}
