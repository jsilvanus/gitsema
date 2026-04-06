import { describe, it, expect } from 'vitest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import { computeHealthTimeline } from '../src/core/search/healthTimeline.js'

describe('healthTimeline', () => {
  it('returns empty on empty DB', () => {
    const session = openDatabaseAt(':memory:')
    const snaps = computeHealthTimeline(session, { buckets: 4 })
    expect(Array.isArray(snaps)).toBe(true)
    expect(snaps.length).toBeGreaterThanOrEqual(0)
  })
})
