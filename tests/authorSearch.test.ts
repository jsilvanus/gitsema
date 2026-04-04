import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeAuthorContributions } from '../src/core/search/authorSearch.js'

vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn(),
}))

import { getActiveSession } from '../src/core/db/sqlite.js'

function toBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec)
  return Buffer.from(f32.buffer)
}

function makeDbMock(options: {
  embRows?: Array<{ blobHash: string; vector: Buffer }>
  commitRows?: Array<any>
  pathRows?: Array<{ blobHash: string; path: string }>
}) {
  const embRows = options.embRows ?? []
  const commitRows = options.commitRows ?? []
  const pathRows = options.pathRows ?? []

  const db = {
    select: vi.fn().mockImplementation((sel: any) => {
      // embeddings selection -> contains 'vector'
      if (sel && Object.keys(sel).includes('vector')) {
        return { from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(embRows) }) }
      }
      // paths selection -> contains 'path'
      if (sel && Object.keys(sel).includes('path')) {
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(pathRows) }) }) }
      }
      // blob_commits join commits -> contains timestamp
      if (sel && Object.keys(sel).includes('timestamp')) {
        return { from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(commitRows) }) }) }) }
      }
      // fallback
      return { from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }) }
    }),
  }

  return { db }
}

describe('computeAuthorContributions', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('aggregates scores by author', async () => {
    // two blobs: a [1,0], b [0,1]
    const embRows = [
      { blobHash: 'a', vector: toBuffer([1, 0]) },
      { blobHash: 'b', vector: toBuffer([0, 1]) },
    ]

    // earliest commits per blob (joined rows)
    const commitRows = [
      { blobHash: 'a', commitHash: 'c1', timestamp: 100, message: 'm1', authorName: 'Alice', authorEmail: 'alice@example.com' },
      { blobHash: 'b', commitHash: 'c2', timestamp: 200, message: 'm2', authorName: 'Bob', authorEmail: 'bob@example.com' },
    ]

    const pathRows = [
      { blobHash: 'a', path: 'src/a.ts' },
      { blobHash: 'b', path: 'src/b.ts' },
    ]

    vi.mocked(getActiveSession).mockReturnValue(makeDbMock({ embRows, commitRows, pathRows }) as any)

    // query [1,0] → blob 'a' scores 1, 'b' scores 0
    const results = await computeAuthorContributions([1, 0])
    expect(results.length).toBe(2)

    const alice = results.find((r) => r.authorName === 'Alice')!
    const bob = results.find((r) => r.authorName === 'Bob')!

    expect(alice).toBeDefined()
    expect(bob).toBeDefined()
    expect(alice.blobCount).toBe(1)
    expect(bob.blobCount).toBe(1)
    expect(alice.totalScore).toBeGreaterThan(bob.totalScore)
  })

  it('respects since filter', async () => {
    const embRows = [
      { blobHash: 'a', vector: toBuffer([1, 0]) },
      { blobHash: 'b', vector: toBuffer([1, 0]) },
    ]

    const commitRows = [
      { blobHash: 'a', commitHash: 'c1', timestamp: 100, message: 'm1', authorName: 'Alice', authorEmail: 'alice@example.com' },
      { blobHash: 'b', commitHash: 'c2', timestamp: 200, message: 'm2', authorName: 'Bob', authorEmail: 'bob@example.com' },
    ]

    const pathRows = [ { blobHash: 'a', path: 'src/a.ts' }, { blobHash: 'b', path: 'src/b.ts' } ]

    vi.mocked(getActiveSession).mockReturnValue(makeDbMock({ embRows, commitRows, pathRows }) as any)

    // since = 150 should exclude 'a' (ts=100)
    const results = await computeAuthorContributions([1, 0], { since: 150 })
    expect(results.length).toBe(1)
    const names = results.map((r) => r.authorName)
    expect(names).not.toContain('Alice')
    expect(names).toContain('Bob')
  })

  it('honors topAuthors limit', async () => {
    // 3 authors with small scores
    const embRows = [
      { blobHash: 'a', vector: toBuffer([1, 0]) },
      { blobHash: 'b', vector: toBuffer([0.9, 0.1]) },
      { blobHash: 'c', vector: toBuffer([0.1, 0.9]) },
    ]

    const commitRows = [
      { blobHash: 'a', commitHash: 'c1', timestamp: 100, message: 'm1', authorName: 'A', authorEmail: 'a@e' },
      { blobHash: 'b', commitHash: 'c2', timestamp: 110, message: 'm2', authorName: 'B', authorEmail: 'b@e' },
      { blobHash: 'c', commitHash: 'c3', timestamp: 120, message: 'm3', authorName: 'C', authorEmail: 'c@e' },
    ]

    const pathRows = [ { blobHash: 'a', path: 'p' }, { blobHash: 'b', path: 'q' }, { blobHash: 'c', path: 'r' } ]

    vi.mocked(getActiveSession).mockReturnValue(makeDbMock({ embRows, commitRows, pathRows }) as any)

    const results = await computeAuthorContributions([1, 0], { topAuthors: 1 })
    expect(results.length).toBe(1)
  })

  it('excludes blobs with no commits', async () => {
    const embRows = [
      { blobHash: 'a', vector: toBuffer([1, 0]) },
      { blobHash: 'b', vector: toBuffer([0, 1]) },
    ]

    // only 'a' has a commit
    const commitRows = [
      { blobHash: 'a', commitHash: 'c1', timestamp: 100, message: 'm1', authorName: 'Alice', authorEmail: 'alice' },
    ]

    const pathRows = [ { blobHash: 'a', path: 'src/a' }, { blobHash: 'b', path: 'src/b' } ]

    vi.mocked(getActiveSession).mockReturnValue(makeDbMock({ embRows, commitRows, pathRows }) as any)

    const results = await computeAuthorContributions([1, 0])
    // only Alice should appear
    expect(results.find((r) => r.authorName === 'Alice')).toBeDefined()
    // ensure no Unknown author for blob b
    const names = results.map((r) => r.authorName)
    expect(names).not.toContain('Unknown')
  })
})
