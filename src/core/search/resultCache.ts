/**
 * Short-TTL in-memory result cache for vector and hybrid search.
 *
 * Design:
 *   - Cache key: SHA-1-like hash of (query text OR serialized query embedding) + relevant options.
 *   - Default TTL: 60 seconds (override via GITSEMA_CACHE_TTL env var, in seconds).
 *   - Invalidation: call `invalidateResultCache()` after any indexing update.
 *   - Max entries: 256 (LRU eviction via insertion-order Map + size cap).
 *
 * The cache is process-local (in-memory only). It is intentionally not shared
 * across worker threads or HTTP server instances.
 */

export * from './analysis/resultCache.js'
