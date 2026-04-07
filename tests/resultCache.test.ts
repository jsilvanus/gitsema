import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildCacheKey,
  embeddingFingerprint,
  getCachedResults,
  setCachedResults,
  invalidateResultCache,
  cacheSize,
  resetResultCache,
} from '../src/core/search/resultCache.js'
import type { SearchResult } from '../src/core/models/types.js'

const RESULT: SearchResult = {
  kind: 'file',
  blobHash: 'abc123',
  paths: ['src/foo.ts'],
  score: 0.95,
}

describe('resultCache', () => {
  beforeEach(() => {
    resetResultCache()
  })

  it('returns null for a cache miss', () => {
    const key = buildCacheKey('hello', { topK: 10 })
    expect(getCachedResults(key)).toBeNull()
  })

  it('stores and retrieves a result', () => {
    const key = buildCacheKey('hello', { topK: 10 })
    setCachedResults(key, [RESULT])
    const cached = getCachedResults(key)
    expect(cached).not.toBeNull()
    expect(cached).toHaveLength(1)
    expect(cached![0].blobHash).toBe('abc123')
  })

  it('different keys are stored independently', () => {
    const key1 = buildCacheKey('hello', { topK: 5 })
    const key2 = buildCacheKey('world', { topK: 5 })
    setCachedResults(key1, [RESULT])
    expect(getCachedResults(key1)).not.toBeNull()
    expect(getCachedResults(key2)).toBeNull()
  })

  it('options order does not matter in key', () => {
    const key1 = buildCacheKey('q', { topK: 5, model: 'x' })
    const key2 = buildCacheKey('q', { model: 'x', topK: 5 })
    expect(key1).toBe(key2)
  })

  it('invalidateResultCache clears all entries', () => {
    const key = buildCacheKey('hello', { topK: 10 })
    setCachedResults(key, [RESULT])
    expect(getCachedResults(key)).not.toBeNull()
    invalidateResultCache()
    // After invalidation the old key includes the old version, but getCachedResults
    // also builds the key with the new version so it will not match.
    expect(cacheSize()).toBe(0)
  })

  it('cacheSize reflects live entries', () => {
    expect(cacheSize()).toBe(0)
    setCachedResults(buildCacheKey('a', {}), [RESULT])
    setCachedResults(buildCacheKey('b', {}), [RESULT])
    expect(cacheSize()).toBe(2)
    invalidateResultCache()
    expect(cacheSize()).toBe(0)
  })

  it('embeddingFingerprint produces compact stable strings', () => {
    const vec = [0.1, 0.2, 0.3, 0.4]
    const fp1 = embeddingFingerprint(vec)
    const fp2 = embeddingFingerprint(vec)
    expect(fp1).toBe(fp2)
    expect(fp1).toContain('4:') // length prefix
    expect(fp1.length).toBeLessThan(80)
  })

  it('embeddingFingerprint truncates long vectors', () => {
    const longVec = Array.from({ length: 768 }, (_, i) => i * 0.001)
    const fp = embeddingFingerprint(longVec)
    // Only first 8 values + length prefix should appear
    expect(fp).toContain('768:')
    // Should not contain the 9th value (0.008) directly since we truncate at 8
    const parts = fp.split(':')[1].split(',').filter(Boolean)
    expect(parts).toHaveLength(8)
  })
})
