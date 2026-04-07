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

import type { SearchResult } from '../models/types.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default TTL for cached results, in milliseconds. */
const DEFAULT_TTL_MS = 60_000

function getTtlMs(): number {
  const raw = process.env.GITSEMA_CACHE_TTL
  if (raw) {
    const secs = parseInt(raw, 10)
    if (Number.isFinite(secs) && secs > 0) return secs * 1_000
  }
  return DEFAULT_TTL_MS
}

const MAX_ENTRIES = 256

// ---------------------------------------------------------------------------
// Cache state
// ---------------------------------------------------------------------------

interface CacheEntry {
  results: SearchResult[]
  expiresAt: number
}

/** The result cache: key → {results, expiresAt}. Insertion order used for LRU eviction. */
let cache = new Map<string, CacheEntry>()

/** Monotonic version counter. Bumped on every indexing mutation. Used in cache key. */
let indexVersion = 0

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

/**
 * Builds a cache key from the query text/embedding and the relevant options.
 * We stringify the options into a stable JSON string for comparison.
 *
 * For embedding-based queries we use a fast fingerprint: the first 8 floats +
 * dimension count. This avoids hashing large Float32Arrays while still being
 * collision-resistant enough for a 60-second cache.
 */
export function buildCacheKey(
  queryText: string,
  options: Record<string, unknown>,
): string {
  const optStr = JSON.stringify(options, Object.keys(options).sort())
  return `v${indexVersion}:${queryText}:${optStr}`
}

/**
 * Returns a short fingerprint of an embedding vector for use in a cache key.
 * Uses the first 8 values + length so the key stays compact.
 */
export function embeddingFingerprint(vec: ArrayLike<number>): string {
  const n = Math.min(8, vec.length)
  let s = `${vec.length}:`
  for (let i = 0; i < n; i++) s += vec[i].toFixed(5) + ','
  return s
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Retrieve a cached result set. Returns null when not cached or expired. */
export function getCachedResults(key: string): SearchResult[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.results
}

/** Store results in the cache under `key`. Evicts oldest entry when cap is reached. */
export function setCachedResults(key: string, results: SearchResult[]): void {
  if (cache.size >= MAX_ENTRIES) {
    // LRU eviction: delete the oldest (first inserted) entry
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) cache.delete(firstKey)
  }
  cache.set(key, { results, expiresAt: Date.now() + getTtlMs() })
}

/**
 * Invalidates the entire result cache.
 * Call this after any indexing mutation (blob indexed, commit marked, etc.) so
 * subsequent searches see fresh results.
 */
export function invalidateResultCache(): void {
  indexVersion++
  cache = new Map()
}

/** Returns the current number of live (non-expired) entries. For testing only. */
export function cacheSize(): number {
  const now = Date.now()
  let count = 0
  for (const entry of cache.values()) {
    if (now <= entry.expiresAt) count++
  }
  return count
}

/** Resets the cache and version counter. For testing only. */
export function resetResultCache(): void {
  indexVersion = 0
  cache = new Map()
}
