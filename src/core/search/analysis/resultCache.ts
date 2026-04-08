import type { SearchResult } from '../../models/types.js'

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

interface CacheEntry {
  results: SearchResult[]
  expiresAt: number
}

let cache = new Map<string, CacheEntry>()
let indexVersion = 0

export function buildCacheKey(
  queryText: string,
  options: Record<string, unknown>,
): string {
  const optStr = JSON.stringify(options, Object.keys(options).sort())
  return `v${indexVersion}:${queryText}:${optStr}`
}

export function embeddingFingerprint(vec: ArrayLike<number>): string {
  const n = Math.min(8, vec.length)
  let s = `${vec.length}:`
  for (let i = 0; i < n; i++) s += vec[i].toFixed(5) + ','
  return s
}

export function getCachedResults(key: string): SearchResult[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.results
}

export function setCachedResults(key: string, results: SearchResult[]): void {
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) cache.delete(firstKey)
  }
  cache.set(key, { results, expiresAt: Date.now() + getTtlMs() })
}

export function invalidateResultCache(): void {
  indexVersion++
  cache = new Map()
}

export function cacheSize(): number {
  const now = Date.now()
  let count = 0
  for (const entry of cache.values()) {
    if (now <= entry.expiresAt) count++
  }
  return count
}

export function resetResultCache(): void {
  indexVersion = 0
  cache = new Map()
}
