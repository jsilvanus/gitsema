import { describe, it, expect, vi } from 'vitest'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { scanForVulnerabilities } from '../src/core/search/securityScan.js'

describe('securityScan', () => {
  it('returns empty findings on empty DB', async () => {
    const session = openDatabaseAt(':memory:')
    const results = await scanForVulnerabilities(session, { model: 'm' }, { top: 5 } as any)
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(0)
  })
})
