import { describe, it, expect } from 'vitest'
import { meanVector } from '../src/core/search/deadConcepts.js'
import { moduleOf, buildModuleGroups } from '../src/core/search/impact.js'
import type { ImpactResult } from '../src/core/search/impact.js'

// We test the pure helper functions exported from the core modules.
// The full async `findDeadConcepts` and `computeImpact` functions require a
// live SQLite database and are exercised by the integration tests instead.

// ---------------------------------------------------------------------------
// meanVector (exported from deadConcepts.ts)
// ---------------------------------------------------------------------------

describe('meanVector', () => {
  it('returns null for an empty array', () => {
    expect(meanVector([])).toBeNull()
  })

  it('returns the single vector unchanged for a one-element array', () => {
    const result = meanVector([[1, 2, 3]])
    expect(result).not.toBeNull()
    expect(result![0]).toBeCloseTo(1)
    expect(result![1]).toBeCloseTo(2)
    expect(result![2]).toBeCloseTo(3)
  })

  it('computes the element-wise mean of two vectors', () => {
    const result = meanVector([[1, 3], [3, 1]])
    expect(result).not.toBeNull()
    expect(result![0]).toBeCloseTo(2)
    expect(result![1]).toBeCloseTo(2)
  })

  it('computes the mean of three equal vectors correctly', () => {
    const v = [0.5, 0.5, 0.5]
    const result = meanVector([v, v, v])
    expect(result).not.toBeNull()
    for (let i = 0; i < 3; i++) {
      expect(result![i]).toBeCloseTo(0.5)
    }
  })

  it('handles negative values', () => {
    const result = meanVector([[-1, 2], [1, -2]])
    expect(result).not.toBeNull()
    expect(result![0]).toBeCloseTo(0)
    expect(result![1]).toBeCloseTo(0)
  })
})

// ---------------------------------------------------------------------------
// Impact helpers — moduleOf logic
// ---------------------------------------------------------------------------

describe('moduleOf', () => {
  it('returns the directory for a nested path', () => {
    expect(moduleOf('src/auth/jwt.ts')).toBe('src/auth')
  })

  it('returns "." for a root-level file', () => {
    expect(moduleOf('index.ts')).toBe('.')
  })

  it('handles deeply nested paths', () => {
    expect(moduleOf('a/b/c/d/file.ts')).toBe('a/b/c/d')
  })

  it('returns the parent directory for a single-level path', () => {
    expect(moduleOf('src/main.ts')).toBe('src')
  })
})

// ---------------------------------------------------------------------------
// buildModuleGroups (exported from impact.ts)
// ---------------------------------------------------------------------------

describe('buildModuleGroups', () => {
  it('returns an empty array for empty input', () => {
    expect(buildModuleGroups([])).toEqual([])
  })

  it('groups results by module', () => {
    const results: ImpactResult[] = [
      { blobHash: 'aaa', paths: ['src/auth/login.ts'], score: 0.9, module: 'src/auth' },
      { blobHash: 'bbb', paths: ['src/auth/token.ts'], score: 0.8, module: 'src/auth' },
      { blobHash: 'ccc', paths: ['src/db/client.ts'], score: 0.6, module: 'src/db' },
    ]
    const groups = buildModuleGroups(results)
    expect(groups).toHaveLength(2)
    // src/auth should come first (higher maxScore)
    expect(groups[0].module).toBe('src/auth')
    expect(groups[0].count).toBe(2)
    expect(groups[0].maxScore).toBeCloseTo(0.9)
  })

  it('sorts groups by maxScore descending', () => {
    const results: ImpactResult[] = [
      { blobHash: 'x', paths: ['a/b.ts'], score: 0.5, module: 'a' },
      { blobHash: 'y', paths: ['c/d.ts'], score: 0.95, module: 'c' },
    ]
    const groups = buildModuleGroups(results)
    expect(groups[0].module).toBe('c')
    expect(groups[1].module).toBe('a')
  })

  it('deduplicates paths within a group, keeping highest-score entry', () => {
    const results: ImpactResult[] = [
      { blobHash: 'a1', paths: ['src/foo.ts'], score: 0.7, module: 'src' },
      { blobHash: 'a2', paths: ['src/foo.ts'], score: 0.9, module: 'src' },
    ]
    const groups = buildModuleGroups(results)
    expect(groups).toHaveLength(1)
    expect(groups[0].paths).toHaveLength(1)
    expect(groups[0].maxScore).toBeCloseTo(0.9)
  })
})
