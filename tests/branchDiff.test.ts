import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { computeBranchDiff } from '../src/core/search/branchDiff.js'

function makeDb(): ReturnType<typeof openDatabaseAt> {
  const dir = mkdtempSync(join(tmpdir(), 'gitsema-test-'))
  const dbPath = join(dir, 'test.db')
  return openDatabaseAt(dbPath)
}

function float32Buffer(arr: number[]): Buffer {
  return Buffer.from(new Float32Array(arr).buffer)
}

describe('computeBranchDiff', () => {
  it('returns empty results on empty DB', async () => {
    const session = makeDb()
    await withDbSession(session, async () => {
      const res = computeBranchDiff('main', 'feature')
      expect(res.branch1).toBe('main')
      expect(res.branch2).toBe('feature')
      expect(res.uniqueToBranch1).toHaveLength(0)
      expect(res.uniqueToBranch2).toHaveLength(0)
      expect(res.shared).toBe(0)
    })
  })

  it('computes unique and shared blobs correctly', async () => {
    const session = makeDb()
    await withDbSession(session, async () => {
      const raw = session.rawDb
      // insert blobs
      raw.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('a', 10, Date.now())
      raw.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('b', 10, Date.now())
      raw.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('c', 10, Date.now())
      // paths
      raw.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('a', 'src/a.ts')
      raw.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('b', 'src/b.ts')
      raw.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('c', 'src/shared.ts')
      // branches
      raw.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)').run('a', 'main')
      raw.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)').run('b', 'feature')
      raw.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)').run('c', 'main')
      raw.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)').run('c', 'feature')

      const res = computeBranchDiff('main', 'feature')
      expect(res.shared).toBe(1)
      expect(res.uniqueToBranch1.map((x) => x.path)).toEqual(['src/a.ts'])
      expect(res.uniqueToBranch2.map((x) => x.path)).toEqual(['src/b.ts'])
    })
  })

  it('limits results by topK and sorts by path when no query', async () => {
    const session = makeDb()
    await withDbSession(session, async () => {
      const raw = session.rawDb
      // insert 5 blobs on main only
      for (let i = 0; i < 5; i++) {
        const h = `m${i}`
        raw.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run(h, 10, Date.now())
        raw.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run(h, `src/main/file${i}.ts`)
        raw.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)').run(h, 'main')
      }

      const res = computeBranchDiff('main', 'other', { topK: 3 })
      expect(res.uniqueToBranch1).toHaveLength(3)
      // paths should be sorted alphabetically
      const paths = res.uniqueToBranch1.map((e) => e.path)
      const sorted = [...paths].sort()
      expect(paths).toEqual(sorted)
    })
  })

  it('computes similarity scores when queryEmbedding is provided', async () => {
    const session = makeDb()
    await withDbSession(session, async () => {
      const raw = session.rawDb
      // blob x similar to query, blob y not
      raw.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('x', 10, Date.now())
      raw.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('y', 10, Date.now())
      raw.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('x', 'src/x.ts')
      raw.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('y', 'src/y.ts')
      raw.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)').run('x', 'A')
      raw.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)').run('y', 'B')
      // embeddings: x -> [1,0,0], y -> [0,1,0]
      raw.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)').run('x', 'm', 3, float32Buffer([1, 0, 0]))
      raw.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)').run('y', 'm', 3, float32Buffer([0, 1, 0]))

      const res = computeBranchDiff('A', 'B', { topK: 10, queryEmbedding: [1, 0, 0] })
      expect(res.uniqueToBranch1[0].score).toBeGreaterThan(res.uniqueToBranch2[0].score)
      expect(res.uniqueToBranch1[0].path).toBe('src/x.ts')
    })
  })
})
