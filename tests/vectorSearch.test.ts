import { describe, it, expect, vi } from 'vitest'
import { cosineSimilarity, pathRelevanceScore, reservoirSample } from '../src/core/search/vectorSearch.js'

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0)
  })

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
  })

  it('is symmetric', () => {
    const a = [0.5, 0.3, 0.8]
    const b = [0.1, 0.9, 0.2]
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a))
  })

  it('handles unit vectors', () => {
    const a = [1 / Math.SQRT2, 1 / Math.SQRT2]
    const b = [1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(1 / Math.SQRT2)
  })

  it('result is always in [-1, 1]', () => {
    const vecs = [
      [0.1, 0.9, 0.3],
      [-0.5, 0.2, 0.7],
      [1, 0, 0],
      [0, 1, 0],
    ]
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        const sim = cosineSimilarity(vecs[i], vecs[j])
        expect(sim).toBeGreaterThanOrEqual(-1)
        expect(sim).toBeLessThanOrEqual(1)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// pathRelevanceScore
// ---------------------------------------------------------------------------

describe('pathRelevanceScore', () => {
  it('returns 1 when all query tokens appear in path', () => {
    expect(pathRelevanceScore('auth middleware', 'src/middleware/auth.ts')).toBe(1)
  })

  it('returns 0 when no query tokens appear in path', () => {
    expect(pathRelevanceScore('database migration', 'src/middleware/auth.ts')).toBe(0)
  })

  it('returns fraction when only some tokens match', () => {
    const score = pathRelevanceScore('auth database', 'src/middleware/auth.ts')
    expect(score).toBeCloseTo(0.5)
  })

  it('is case-insensitive', () => {
    expect(pathRelevanceScore('AUTH', 'src/Auth.ts')).toBe(1)
  })

  it('returns 0 for empty query', () => {
    expect(pathRelevanceScore('', 'src/auth.ts')).toBe(0)
  })

  it('ignores punctuation tokens', () => {
    // Tokens from splitting on \W+ — non-word chars produce no tokens
    const score = pathRelevanceScore('!!! ---', 'src/auth.ts')
    expect(score).toBe(0)
  })

  it('handles partial substring matches', () => {
    // "auth" appears as a substring of "authentication"
    expect(pathRelevanceScore('auth', 'src/authentication.ts')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// reservoirSample (early-cut helper)
// ---------------------------------------------------------------------------

describe('reservoirSample', () => {
  it('returns the pool unchanged when k >= pool.length', () => {
    const pool = [1, 2, 3]
    expect(reservoirSample(pool, 5)).toBe(pool) // same reference
    expect(reservoirSample(pool, 3)).toBe(pool)
  })

  it('returns exactly k items when pool is larger than k', () => {
    const pool = Array.from({ length: 100 }, (_, i) => i)
    const sample = reservoirSample(pool, 10)
    expect(sample).toHaveLength(10)
  })

  it('all sampled items come from the original pool', () => {
    const pool = Array.from({ length: 50 }, (_, i) => i)
    const poolSet = new Set(pool)
    const sample = reservoirSample(pool, 5)
    for (const item of sample) {
      expect(poolSet.has(item)).toBe(true)
    }
  })

  it('does not produce duplicate items in the sample', () => {
    const pool = Array.from({ length: 50 }, (_, i) => i)
    const sample = reservoirSample(pool, 20)
    const sampleSet = new Set(sample)
    expect(sampleSet.size).toBe(20)
  })

  it('uses Math.random and is deterministic when stubbed', () => {
    // Always return j = 0 so every new item replaces reservoir[0]
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const pool = [10, 20, 30, 40, 50]
    const sample = reservoirSample(pool, 2)
    // With Math.random() === 0 for all i >= k=2:
    // i=2: j = floor(0 * 3) = 0 → reservoir[0] = pool[2] = 30  → [30, 20]
    // i=3: j = floor(0 * 4) = 0 → reservoir[0] = pool[3] = 40  → [40, 20]
    // i=4: j = floor(0 * 5) = 0 → reservoir[0] = pool[4] = 50  → [50, 20]
    expect(sample).toEqual([50, 20])
    vi.restoreAllMocks()
  })
})
