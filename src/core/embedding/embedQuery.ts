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
import { incQueryCacheHit, incQueryCacheMiss } from '../../utils/metricsCounters.js'
import { getModelProfile } from '../config/configManager.js'

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

  // Apply query prefix from the model's profile, if configured.
  // The prefix is baked into the cache key so the cache correctly stores
  // prefixed embeddings and invalidates when the prefix changes.
  const profile = getModelProfile(provider.model)
  const queryPrefix = profile.prefixes?.['query']
  const effectiveQuery = queryPrefix ? `${queryPrefix} ${query}` : query

  if (!noCache) {
    const cached = getCachedQueryEmbedding(effectiveQuery, provider.model)
    if (cached) {
      incQueryCacheHit()
      return cached
    }
    incQueryCacheMiss()
  }

  const embedding = await provider.embed(effectiveQuery)

  if (!noCache) {
    try {
      setCachedQueryEmbedding(effectiveQuery, provider.model, embedding)
    } catch {
      // Cache write failures are non-fatal — the embedding is still returned.
    }
  }

  return embedding
}
