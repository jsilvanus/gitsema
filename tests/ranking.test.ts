import { describe, it, expect } from 'vitest'
import {
  shortHash,
  formatScore,
  formatDate,
  groupResults,
  renderResults,
} from '../src/core/search/ranking.js'
import type { SearchResult } from '../src/core/models/types.js'

// ---------------------------------------------------------------------------
// shortHash
// ---------------------------------------------------------------------------

describe('shortHash', () => {
  it('returns the first 7 characters of a hash', () => {
    expect(shortHash('a3f9c2d1e5b7f0123456789')).toBe('a3f9c2d')
  })

  it('handles a hash that is exactly 7 characters', () => {
    expect(shortHash('abcdefg')).toBe('abcdefg')
  })

  it('handles a hash shorter than 7 characters without throwing', () => {
    expect(shortHash('abc')).toBe('abc')
  })
})

// ---------------------------------------------------------------------------
// formatScore
// ---------------------------------------------------------------------------

describe('formatScore', () => {
  it('formats a score to 3 decimal places', () => {
    expect(formatScore(0.921)).toBe('0.921')
    expect(formatScore(1)).toBe('1.000')
    expect(formatScore(0)).toBe('0.000')
  })

  it('rounds correctly', () => {
    // Use values that round unambiguously in IEEE 754 binary representation
    expect(formatScore(0.9999)).toBe('1.000')
    expect(formatScore(0.1001)).toBe('0.100')
  })
})

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('formats a Unix timestamp (seconds) as YYYY-MM-DD', () => {
    // 2022-03-15 00:00:00 UTC
    expect(formatDate(1647302400)).toBe('2022-03-15')
  })

  it('returns a 10-character string in YYYY-MM-DD format', () => {
    const result = formatDate(1700000000)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// groupResults
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<SearchResult> & { blobHash: string }): SearchResult {
  return {
    paths: [],
    score: 0.5,
    ...overrides,
  }
}

describe('groupResults — file mode', () => {
  it('collapses two results with the same path to the highest-scoring one', () => {
    const results: SearchResult[] = [
      makeResult({ blobHash: 'aaa', paths: ['src/auth.ts'], score: 0.9 }),
      makeResult({ blobHash: 'bbb', paths: ['src/auth.ts'], score: 0.7 }),
    ]
    const grouped = groupResults(results, 'file', 10)
    expect(grouped).toHaveLength(1)
    expect(grouped[0].blobHash).toBe('aaa')
    expect(grouped[0].score).toBe(0.9)
  })

  it('keeps distinct paths as separate results', () => {
    const results: SearchResult[] = [
      makeResult({ blobHash: 'aaa', paths: ['src/auth.ts'], score: 0.9 }),
      makeResult({ blobHash: 'bbb', paths: ['src/index.ts'], score: 0.8 }),
    ]
    const grouped = groupResults(results, 'file', 10)
    expect(grouped).toHaveLength(2)
  })

  it('respects topK', () => {
    const results: SearchResult[] = Array.from({ length: 10 }, (_, i) =>
      makeResult({ blobHash: `hash${i}`, paths: [`file${i}.ts`], score: (10 - i) / 10 }),
    )
    const grouped = groupResults(results, 'file', 3)
    expect(grouped).toHaveLength(3)
  })

  it('sorts output by score descending', () => {
    const results: SearchResult[] = [
      makeResult({ blobHash: 'a', paths: ['low.ts'], score: 0.3 }),
      makeResult({ blobHash: 'b', paths: ['high.ts'], score: 0.9 }),
      makeResult({ blobHash: 'c', paths: ['mid.ts'], score: 0.6 }),
    ]
    const grouped = groupResults(results, 'file', 10)
    expect(grouped[0].score).toBe(0.9)
    expect(grouped[1].score).toBe(0.6)
    expect(grouped[2].score).toBe(0.3)
  })

  it('uses blobHash as key when paths is empty', () => {
    const results: SearchResult[] = [
      makeResult({ blobHash: 'aaa', paths: [], score: 0.9 }),
      makeResult({ blobHash: 'aaa', paths: [], score: 0.7 }),
    ]
    const grouped = groupResults(results, 'file', 10)
    expect(grouped).toHaveLength(1)
  })
})

describe('groupResults — module mode', () => {
  it('collapses results in the same directory', () => {
    const results: SearchResult[] = [
      makeResult({ blobHash: 'a', paths: ['src/auth/login.ts'], score: 0.9 }),
      makeResult({ blobHash: 'b', paths: ['src/auth/logout.ts'], score: 0.7 }),
      makeResult({ blobHash: 'c', paths: ['src/index.ts'], score: 0.5 }),
    ]
    const grouped = groupResults(results, 'module', 10)
    expect(grouped).toHaveLength(2)
    // src/auth group should have the highest score (0.9)
    const authGroup = grouped.find((r) => r.paths[0]?.includes('login'))
    expect(authGroup?.score).toBe(0.9)
  })
})

describe('groupResults — commit mode', () => {
  it('collapses results with the same firstCommit', () => {
    const results: SearchResult[] = [
      makeResult({ blobHash: 'a', paths: ['a.ts'], score: 0.9, firstCommit: 'commit1' }),
      makeResult({ blobHash: 'b', paths: ['b.ts'], score: 0.7, firstCommit: 'commit1' }),
      makeResult({ blobHash: 'c', paths: ['c.ts'], score: 0.5, firstCommit: 'commit2' }),
    ]
    const grouped = groupResults(results, 'commit', 10)
    expect(grouped).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// renderResults
// ---------------------------------------------------------------------------

describe('renderResults', () => {
  it('returns "(no results)" for an empty array', () => {
    expect(renderResults([])).toBe('  (no results)')
  })

  it('includes score, path, and hash', () => {
    const results: SearchResult[] = [
      makeResult({ blobHash: 'a3f9c2d1e5b7f0123456789', paths: ['src/auth.ts'], score: 0.921 }),
    ]
    const output = renderResults(results)
    expect(output).toContain('0.921')
    expect(output).toContain('src/auth.ts')
    expect(output).toContain('[a3f9c2d]')
  })

  it('includes first-seen date when firstSeen is set', () => {
    const results: SearchResult[] = [
      makeResult({
        blobHash: 'aabbccd',
        paths: ['src/api.ts'],
        score: 0.8,
        firstSeen: 1647302400, // 2022-03-15
      }),
    ]
    const output = renderResults(results)
    expect(output).toContain('2022-03-15')
  })

  it('includes line range when startLine/endLine are set', () => {
    const results: SearchResult[] = [
      makeResult({
        blobHash: 'aabbccd',
        paths: ['src/api.ts'],
        score: 0.8,
        startLine: 10,
        endLine: 45,
      }),
    ]
    const output = renderResults(results)
    expect(output).toContain(':10-45')
  })

  it('handles results with no paths', () => {
    const results: SearchResult[] = [
      makeResult({ blobHash: 'aabbccd', paths: [], score: 0.5 }),
    ]
    const output = renderResults(results)
    expect(output).toContain('(unknown path)')
  })
})
