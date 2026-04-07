import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/core/search/vectorSearch.js', () => ({ vectorSearch: vi.fn().mockReturnValue([{ blobHash: 'b1' }, { blobHash: 'b2' }]) }))
vi.mock('../src/core/db/sqlite.js', () => ({ getActiveSession: vi.fn() }))

import { computeOwnershipHeatmap } from '../src/core/search/ownershipHeatmap.js'
import { getActiveSession } from '../src/core/db/sqlite.js'

function makeRawDb() {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM blob_commits')) {
        return { all: vi.fn().mockReturnValue([
          { blobHash: 'b1', authorName: 'Alice', authorEmail: 'a@x', ts: Math.floor(Date.now()/1000) },
          { blobHash: 'b2', authorName: 'Bob', authorEmail: 'b@x', ts: Math.floor(Date.now()/1000) - 100000 },
        ]) }
      }
      if (sql.includes('FROM paths')) {
        return { all: vi.fn().mockReturnValue([
          { blobHash: 'b1', path: 'src/a.ts' }, { blobHash: 'b2', path: 'src/b.ts' }
        ]) }
      }
      return { all: vi.fn().mockReturnValue([]) }
    })
  }
}

describe('computeOwnershipHeatmap', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it('computes simple ownership entries', () => {
    const rawDb = makeRawDb()
    vi.mocked(getActiveSession).mockReturnValue({ rawDb } as any)
    const res = computeOwnershipHeatmap({ embedding: [0.1,0.2], topK: 5, windowDays: 365 })
    expect(res.length).toBeGreaterThan(0)
    expect(res[0]).toHaveProperty('authorName')
  })
})
