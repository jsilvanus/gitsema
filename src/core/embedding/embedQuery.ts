/**
 * Shared query-embedding helper with transparent caching (Phase 18+).
 *
 * Wraps `provider.embed()` with a read-through/write-through cache backed by
 * the `query_embeddings` SQLite table so repeated identical queries do not
 * re-hit the embedding backend.
 *
 * Cache key: (query, provider.model)
 * Cache TTL and size cap are governed by `queryCache.ts`.
 *
 * Callers are responsible for catching errors (e.g. provider unavailable) and
 * converting them to the appropriate exit/response strategy.
 */

import { getCachedQueryEmbedding, setCachedQueryEmbedding } from './queryCache.js'
import type { EmbeddingProvider } from './provider.js'
import type { Embedding } from '../models/types.js'

export interface EmbedQueryOptions {
  /** When true, skip both cache reads and cache writes. Defaults to false. */
  noCache?: boolean
}

/**
 * Embeds `query` with `provider`, transparently reading from and writing to
 * the query embedding cache unless `noCache` is true.
 *
 * @throws Re-throws any error thrown by `provider.embed()`.
 */
export async function embedQuery(
  provider: EmbeddingProvider,
  query: string,
  options: EmbedQueryOptions = {},
): Promise<Embedding> {
  const noCache = options.noCache ?? false

  if (!noCache) {
    const cached = getCachedQueryEmbedding(query, provider.model)
    if (cached) return cached
  }

  const embedding = await provider.embed(query)

  if (!noCache) {
    try {
      setCachedQueryEmbedding(query, provider.model, embedding)
    } catch {
      // Cache write failures are non-fatal — the embedding is still returned.
    }
  }

  return embedding
}
