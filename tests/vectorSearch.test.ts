import { describe, it, expect } from 'vitest'
import { cosineSimilarity, pathRelevanceScore } from '../src/core/search/vectorSearch.js'

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
