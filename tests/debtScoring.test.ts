import { describe, it, expect } from 'vitest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import { scoreDebt } from '../src/core/search/debtScoring.js'

describe('debtScoring', () => {
  it('returns empty on empty DB', () => {
    const session = openDatabaseAt(':memory:')
    const res = scoreDebt(session, { model: 'm' }, { top: 10 })
    expect(Array.isArray(res)).toBe(true)
    expect(res.length).toBe(0)
  })
})
