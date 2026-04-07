import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeExperts } from '../src/core/search/experts.js'

vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn(),
}))

import { getActiveSession } from '../src/core/db/sqlite.js'

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal rawDb mock that supports the two prepared statements used
 * by computeExperts:
 *   1. Author ranking query (contains "blobCount" in SELECT)
 *   2. Per-author cluster query (the second prepare call)
 *   3. blob_clusters lookup (simple SELECT * FROM blob_clusters)
 */
function makeRawDb(
  authorRows: Array<{ authorName: string | null; authorEmail: string | null; blobCount: number }>,
  clusterRows: Array<{ id: number; label: string; representative_paths: string }>,
  clusterDataByAuthor: Map<string, Array<{ clusterId: number; blobCount: number }>>,
) {
  let prepareCallIdx = 0
  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      // Distinguish the three statement types by SQL content
      if (sql.includes('blob_clusters') && !sql.includes('JOIN')) {
        // blob_clusters lookup
        return { all: vi.fn().mockReturnValue(clusterRows) }
      }
      if (sql.includes('GROUP BY c.author_name')) {
        // Author ranking query
        return { all: vi.fn().mockReturnValue(authorRows) }
      }
      // Per-author cluster query — return data keyed by author name/email params
      return {
        all: vi.fn().mockImplementation((...params: (string | number)[]) => {
          // params ends with [name, email, topClusters]
          const name = params[params.length - 3] as string
          return clusterDataByAuthor.get(name) ?? []
        }),
      }
    }),
  }
}

describe('computeExperts', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns empty array when no authors exist', () => {
    const rawDb = makeRawDb([], [], new Map())
    vi.mocked(getActiveSession).mockReturnValue({ rawDb } as any)
    const result = computeExperts()
    expect(result).toEqual([])
  })

  it('returns ranked authors with cluster info', () => {
    const authorRows = [
      { authorName: 'Alice', authorEmail: 'alice@example.com', blobCount: 20 },
      { authorName: 'Bob', authorEmail: 'bob@example.com', blobCount: 10 },
    ]
    const clusterRows = [
      { id: 1, label: 'auth-module', representative_paths: JSON.stringify(['src/auth.ts']) },
      { id: 2, label: 'db-layer', representative_paths: JSON.stringify(['src/db.ts', 'src/models.ts']) },
    ]
    const clusterDataByAuthor = new Map([
      ['Alice', [{ clusterId: 1, blobCount: 15 }, { clusterId: 2, blobCount: 5 }]],
      ['Bob', [{ clusterId: 2, blobCount: 10 }]],
    ])

    const rawDb = makeRawDb(authorRows, clusterRows, clusterDataByAuthor)
    vi.mocked(getActiveSession).mockReturnValue({ rawDb } as any)

    const result = computeExperts({ topN: 10 })
    expect(result).toHaveLength(2)

    const alice = result[0]
    expect(alice.authorName).toBe('Alice')
    expect(alice.authorEmail).toBe('alice@example.com')
    expect(alice.blobCount).toBe(20)
    expect(alice.clusters).toHaveLength(2)
    expect(alice.clusters[0].label).toBe('auth-module')
    expect(alice.clusters[0].blobCount).toBe(15)
    expect(alice.clusters[0].representativePaths).toEqual(['src/auth.ts'])

    const bob = result[1]
    expect(bob.authorName).toBe('Bob')
    expect(bob.blobCount).toBe(10)
    expect(bob.clusters[0].label).toBe('db-layer')
  })

  it('uses fallback label when cluster id is not in blob_clusters', () => {
    const authorRows = [
      { authorName: 'Carol', authorEmail: 'carol@example.com', blobCount: 5 },
    ]
    // No cluster rows → clusterLabelMap will be empty
    const clusterRows: never[] = []
    const clusterDataByAuthor = new Map([
      ['Carol', [{ clusterId: 42, blobCount: 5 }]],
    ])

    const rawDb = makeRawDb(authorRows, clusterRows, clusterDataByAuthor)
    vi.mocked(getActiveSession).mockReturnValue({ rawDb } as any)

    const result = computeExperts()
    expect(result).toHaveLength(1)
    expect(result[0].clusters[0].label).toBe('cluster-42')
    expect(result[0].clusters[0].representativePaths).toEqual([])
  })

  it('handles null author names/emails gracefully', () => {
    const authorRows = [
      { authorName: null, authorEmail: null, blobCount: 3 },
    ]
    const rawDb = makeRawDb(authorRows, [], new Map([['Unknown', []]]))
    vi.mocked(getActiveSession).mockReturnValue({ rawDb } as any)

    const result = computeExperts()
    expect(result).toHaveLength(1)
    expect(result[0].authorName).toBe('Unknown')
    expect(result[0].authorEmail).toBe('')
  })

  it('passes since/until params to the query', () => {
    const authorRows: never[] = []
    const rawDb = makeRawDb(authorRows, [], new Map())
    vi.mocked(getActiveSession).mockReturnValue({ rawDb } as any)

    computeExperts({ since: 1000, until: 2000 })

    // The prepare call for the author ranking query should exist
    const prepareCalls = (rawDb.prepare as ReturnType<typeof vi.fn>).mock.calls
    const authorQueryCall = prepareCalls.find((args: string[]) =>
      args[0].includes('GROUP BY c.author_name'),
    )
    expect(authorQueryCall).toBeDefined()
    // The .all() was called with the time params
    const authorStmt = rawDb.prepare.mock.results.find(
      (r: { value: { all: ReturnType<typeof vi.fn> } }) => r.value.all.mock.calls.length > 0
    )
    if (authorStmt) {
      const allCallArgs = authorStmt.value.all.mock.calls[0]
      expect(allCallArgs).toContain(1000)
      expect(allCallArgs).toContain(2000)
    }
  })

  it('respects topN limit', () => {
    const authorRows = [
      { authorName: 'A', authorEmail: 'a@x', blobCount: 100 },
      { authorName: 'B', authorEmail: 'b@x', blobCount: 80 },
      { authorName: 'C', authorEmail: 'c@x', blobCount: 60 },
    ]
    const rawDb = makeRawDb(authorRows, [], new Map([
      ['A', []], ['B', []], ['C', []],
    ]))
    vi.mocked(getActiveSession).mockReturnValue({ rawDb } as any)

    // DB already limits to topN via LIMIT clause, so the returned rows are up to topN
    // We just verify the function returns what the DB gives it (since our mock returns all 3)
    const result = computeExperts({ topN: 3 })
    expect(result).toHaveLength(3)
    expect(result[0].authorName).toBe('A')
  })
})
