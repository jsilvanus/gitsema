/**
 * Regression test for multiRepoSearch (review9 §7.1).
 *
 * Previously the loop opened each repo's DB with openDatabaseAt() but never
 * activated it, so vectorSearch ran against the caller's active session for
 * every repo (wrong results), and the opened connections were never closed
 * (leak). This test verifies results now come from each repo's own index.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { storeBlob } from '../src/core/indexing/blobStore.js'
import { addRepo, multiRepoSearch } from '../src/core/indexing/repoRegistry.js'

const MODEL = 'test-model'

function seed(dbPath: string, blobHash: string, path: string, embedding: number[]): void {
  const session = openDatabaseAt(dbPath)
  try {
    withDbSession(session, async () => {
      storeBlob({ blobHash, size: 10, path, model: MODEL, embedding, content: path })
    })
  } finally {
    session.rawDb.close()
  }
}

describe('multiRepoSearch', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitsema-multirepo-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns results from each repo’s own index, tagged with repoId', async () => {
    const db1 = join(dir, 'repo1.db')
    const db2 = join(dir, 'repo2.db')
    const hash1 = 'a'.repeat(40)
    const hash2 = 'b'.repeat(40)
    seed(db1, hash1, 'src/alpha.ts', [1, 0, 0])
    seed(db2, hash2, 'src/beta.ts', [0, 1, 0])

    // The "main" registry session that knows about both repos.
    const main = openDatabaseAt(join(dir, 'main.db'))
    try {
      addRepo(main, 'r1', 'repo-one', null, db1)
      addRepo(main, 'r2', 'repo-two', null, db2)

      const results = await withDbSession(main, () =>
        multiRepoSearch(main, [1, 0, 0], { topK: 10, model: MODEL }),
      )

      const byRepo = new Map(results.map((r) => [r.repoId, r]))
      // Both repos' blobs are found, each tagged with the correct repo.
      expect(byRepo.has('r1')).toBe(true)
      expect(byRepo.has('r2')).toBe(true)
      expect(byRepo.get('r1')!.blobHash).toBe(hash1)
      expect(byRepo.get('r2')!.blobHash).toBe(hash2)
      expect(byRepo.get('r1')!.repoName).toBe('repo-one')
    } finally {
      main.rawDb.close()
    }
  })
})
