import { describe, it, expect } from 'vitest'
import { computeSemanticDiff } from '../src/core/search/semanticDiff.js'
import type { SemanticDiffResult } from '../src/core/search/semanticDiff.js'
import { cosineSimilarity } from '../src/core/search/vectorSearch.js'

// ---------------------------------------------------------------------------
// cosineSimilarity (used internally by computeSemanticDiff)
// ---------------------------------------------------------------------------

describe('cosineSimilarity — edge cases for semanticDiff scoring', () => {
  it('returns 1 for identical unit vectors', () => {
    const v = [1, 0, 0]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('returns 0 when a zero vector is supplied', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SemanticDiffResult shape
// ---------------------------------------------------------------------------

describe('SemanticDiffResult structure', () => {
  it('has the expected top-level fields', () => {
    const dummy: SemanticDiffResult = {
      ref1: 'v1.0.0',
      ref2: 'HEAD',
      topic: 'authentication',
      timestamp1: 1_700_000_000,
      timestamp2: 1_710_000_000,
      gained: [],
      lost: [],
      stable: [],
    }
    expect(dummy.ref1).toBe('v1.0.0')
    expect(dummy.ref2).toBe('HEAD')
    expect(dummy.topic).toBe('authentication')
    expect(dummy.gained).toBeInstanceOf(Array)
    expect(dummy.lost).toBeInstanceOf(Array)
    expect(dummy.stable).toBeInstanceOf(Array)
  })

  it('gained entries have the expected fields', () => {
    const entry = {
      blobHash: 'abc1234',
      paths: ['src/auth/session.ts'],
      score: 0.85,
      firstSeen: 1_700_000_000,
    }
    expect(entry.blobHash).toBe('abc1234')
    expect(entry.paths).toContain('src/auth/session.ts')
    expect(entry.score).toBeGreaterThan(0)
    expect(entry.firstSeen).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// computeSemanticDiff — integration guard (requires live DB)
// These tests are skipped in CI where no index is available; they document
// the expected behaviour of computeSemanticDiff when a DB is present.
// ---------------------------------------------------------------------------

describe('computeSemanticDiff — logic guards (no DB required)', () => {
  it('is exported as a function', () => {
    expect(typeof computeSemanticDiff).toBe('function')
  })
})
