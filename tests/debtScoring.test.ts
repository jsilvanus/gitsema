import { describe, it, expect } from 'vitest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import { scoreDebt, computeIsolationCosineScan } from '../src/core/search/debtScoring.js'

describe('debtScoring', () => {
  it('returns empty on empty DB', async () => {
    const session = openDatabaseAt(':memory:')
    const res = await scoreDebt(session, { model: 'm' } as any, { top: 10 })
    expect(Array.isArray(res)).toBe(true)
    expect(res.length).toBe(0)
  })

  it('computeIsolationCosineScan returns 0.5 for single blob', () => {
    const rows = [{ blob_hash: 'abc', vec: new Float32Array([1, 0, 0]) }]
    const scores = computeIsolationCosineScan(rows)
    // Single blob has no neighbours to compare — should return 0.5
    expect(scores.get('abc')).toBe(0.5)
  })

  it('computeIsolationCosineScan returns 0 isolation for identical vectors', () => {
    const rows = [
      { blob_hash: 'a', vec: new Float32Array([1, 0, 0]) },
      { blob_hash: 'b', vec: new Float32Array([1, 0, 0]) },
      { blob_hash: 'c', vec: new Float32Array([1, 0, 0]) },
    ]
    const scores = computeIsolationCosineScan(rows)
    // All identical → cosine sim = 1 → isolation = 1 - 1 = 0
    expect(scores.get('a')).toBeCloseTo(0, 5)
    expect(scores.get('b')).toBeCloseTo(0, 5)
  })

  it('computeIsolationCosineScan returns 1 isolation for orthogonal vectors', () => {
    const rows = [
      { blob_hash: 'x', vec: new Float32Array([1, 0, 0]) },
      { blob_hash: 'y', vec: new Float32Array([0, 1, 0]) },
      { blob_hash: 'z', vec: new Float32Array([0, 0, 1]) },
    ]
    const scores = computeIsolationCosineScan(rows)
    // All orthogonal → cosine sim = 0 → isolation = 1 - 0 = 1
    expect(scores.get('x')).toBeCloseTo(1, 5)
  })
})
