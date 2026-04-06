import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import { addRepo, listRepos, getRepo } from '../src/core/indexing/repoRegistry.js'

describe('repoRegistry', () => {
  it('adds and lists repos', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-repos-'))
    const dbPath = join(tmpDir, 'test.db')
    const session = openDatabaseAt(dbPath)

    addRepo(session, 'r1', 'Repo One', 'https://github.com/org/repo1.git')
    addRepo(session, 'r2', 'Repo Two')

    const list = listRepos(session)
    expect(list.length).toBeGreaterThanOrEqual(2)

    const r1 = getRepo(session, 'r1')
    expect(r1).not.toBeNull()
    expect(r1?.name).toBe('Repo One')

    rmSync(tmpDir, { recursive: true, force: true })
  })
})
