import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getBranchExclusiveBlobs } from '../src/core/git/branchDiff.js'

// ---------------------------------------------------------------------------
// getMergeBase — delegates to git, tested via integration; we unit-test
// getBranchExclusiveBlobs which queries the DB.
// ---------------------------------------------------------------------------

vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn(),
}))

// Mock execFileSync so we don't need a real git repo
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

import { execFileSync } from 'node:child_process'
import { getActiveSession } from '../src/core/db/sqlite.js'

const mockExecFileSync = vi.mocked(execFileSync)
const mockGetActiveSession = vi.mocked(getActiveSession)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawDb(rows: Array<{ blob_hash: string }>): InstanceType<import('better-sqlite3').default> {
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue(rows),
    }),
  } as unknown as InstanceType<import('better-sqlite3').default>
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getBranchExclusiveBlobs
// ---------------------------------------------------------------------------

describe('getBranchExclusiveBlobs', () => {
  it('returns empty array when git log produces no commits', () => {
    mockExecFileSync.mockReturnValue('')
    const rawDb = makeRawDb([])
    mockGetActiveSession.mockReturnValue({ rawDb } as ReturnType<typeof getActiveSession>)

    const result = getBranchExclusiveBlobs('feature/foo', 'abc1234abcd1234abcd1234abcd1234abcd1234a')
    expect(result).toEqual([])
    expect(rawDb.prepare).not.toHaveBeenCalled()
  })

  it('returns empty array when git throws (branch not found)', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('unknown revision') })
    const rawDb = makeRawDb([])
    mockGetActiveSession.mockReturnValue({ rawDb } as ReturnType<typeof getActiveSession>)

    const result = getBranchExclusiveBlobs('no-such-branch', 'abc1234abcd1234abcd1234abcd1234abcd1234a')
    expect(result).toEqual([])
  })

  it('queries blob_commits for commit hashes returned by git log', () => {
    const commitHashes = [
      'a'.repeat(40),
      'b'.repeat(40),
    ]
    mockExecFileSync.mockReturnValue(commitHashes.join('\n') + '\n')
    const blobs = [{ blob_hash: 'blob1' }, { blob_hash: 'blob2' }]
    const rawDb = makeRawDb(blobs)
    mockGetActiveSession.mockReturnValue({ rawDb } as ReturnType<typeof getActiveSession>)

    const result = getBranchExclusiveBlobs('feature/bar', 'c'.repeat(40))
    expect(result).toHaveLength(2)
    expect(result).toContain('blob1')
    expect(result).toContain('blob2')
    expect(rawDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT blob_hash FROM blob_commits'),
    )
  })

  it('deduplicates blob hashes returned across multiple rows', () => {
    mockExecFileSync.mockReturnValue('a'.repeat(40) + '\n')
    const rawDb = makeRawDb([
      { blob_hash: 'same-blob' },
      { blob_hash: 'same-blob' }, // duplicate
      { blob_hash: 'other-blob' },
    ])
    mockGetActiveSession.mockReturnValue({ rawDb } as ReturnType<typeof getActiveSession>)

    const result = getBranchExclusiveBlobs('feature/baz', 'd'.repeat(40))
    expect(result).toHaveLength(2)
    expect(new Set(result).size).toBe(2)
  })

  it('filters out lines that are not valid commit hashes', () => {
    const validHash = 'e'.repeat(40)
    mockExecFileSync.mockReturnValue(`\n  \n${validHash}\nnot-a-hash\n`)
    const rawDb = makeRawDb([{ blob_hash: 'blobX' }])
    mockGetActiveSession.mockReturnValue({ rawDb } as ReturnType<typeof getActiveSession>)

    getBranchExclusiveBlobs('feature/qux', 'f'.repeat(40))
    // The prepare call's all() should have been called once (one valid batch)
    expect(rawDb.prepare).toHaveBeenCalledTimes(1)
  })
})
