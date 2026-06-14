import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import {
  normalizeRepoUrl,
  deriveRepoId,
  findRepoByNormalizedUrl,
  registerPersistedRepo,
  touchLastIndexed,
  removeRepo,
  withRepoLock,
  getRepoDir,
  getRepoClonePath,
  getRepoDbPath,
} from '../src/core/indexing/repoRegistry.js'

describe('normalizeRepoUrl', () => {
  it('strips credentials, trailing .git, and trailing slashes from https URLs', () => {
    expect(normalizeRepoUrl('https://user:pass@github.com/org/repo.git/'))
      .toBe('https://github.com/org/repo')
  })

  it('lowercases the host', () => {
    expect(normalizeRepoUrl('https://GitHub.com/org/Repo.git'))
      .toBe('https://github.com/org/Repo')
  })

  it('normalizes SCP-style URLs by lowercasing', () => {
    expect(normalizeRepoUrl('git@GitHub.com:Org/Repo.git'))
      .toBe('git@github.com:org/repo')
  })

  it('produces the same result for equivalent URLs with/without credentials', () => {
    const a = normalizeRepoUrl('https://github.com/org/repo.git')
    const b = normalizeRepoUrl('https://token:x-oauth-basic@github.com/org/repo.git')
    expect(a).toBe(b)
  })
})

describe('deriveRepoId', () => {
  it('is deterministic for the same normalized URL', () => {
    const url = normalizeRepoUrl('https://github.com/org/repo.git')
    expect(deriveRepoId(url)).toBe(deriveRepoId(url))
  })

  it('produces a 16-character hex string', () => {
    const id = deriveRepoId(normalizeRepoUrl('https://github.com/org/repo.git'))
    expect(id).toMatch(/^[a-f0-9]{16}$/)
  })

  it('differs for different normalized URLs', () => {
    const idA = deriveRepoId(normalizeRepoUrl('https://github.com/org/repo-a.git'))
    const idB = deriveRepoId(normalizeRepoUrl('https://github.com/org/repo-b.git'))
    expect(idA).not.toBe(idB)
  })
})

describe('getRepoDir / getRepoClonePath / getRepoDbPath', () => {
  it('derives consistent paths from a repoId', () => {
    const repoId = 'abc123abc123abcd'
    expect(getRepoClonePath(repoId)).toBe(join(getRepoDir(repoId), 'repo'))
    expect(getRepoDbPath(repoId)).toBe(join(getRepoDir(repoId), 'index.db'))
  })
})

describe('registerPersistedRepo / findRepoByNormalizedUrl / touchLastIndexed / removeRepo', () => {
  it('registers, finds, updates, and removes a persisted repo', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-registry-'))
    const session = openDatabaseAt(join(tmpDir, 'registry.db'))

    const normalizedUrl = normalizeRepoUrl('https://github.com/org/repo.git')
    const repoId = deriveRepoId(normalizedUrl)

    registerPersistedRepo(session, {
      id: repoId,
      name: 'repo',
      url: 'https://github.com/org/repo.git',
      normalizedUrl,
      clonePath: getRepoClonePath(repoId),
      dbPath: getRepoDbPath(repoId),
    })

    const found = findRepoByNormalizedUrl(session, normalizedUrl)
    expect(found).not.toBeNull()
    expect(found?.id).toBe(repoId)
    expect(found?.ephemeral).toBe(false)
    expect(found?.lastIndexedAt).toBeFalsy()

    touchLastIndexed(session, repoId)
    const afterTouch = findRepoByNormalizedUrl(session, normalizedUrl)
    expect(afterTouch?.lastIndexedAt).toBeTruthy()

    // Re-registering with the same id upserts rather than duplicating.
    registerPersistedRepo(session, {
      id: repoId,
      name: 'repo-renamed',
      url: 'https://github.com/org/repo.git',
      normalizedUrl,
      clonePath: getRepoClonePath(repoId),
      dbPath: getRepoDbPath(repoId),
    })
    const afterUpsert = findRepoByNormalizedUrl(session, normalizedUrl)
    expect(afterUpsert?.name).toBe('repo-renamed')

    removeRepo(session, repoId)
    expect(findRepoByNormalizedUrl(session, normalizedUrl)).toBeNull()

    session.rawDb.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('withRepoLock', () => {
  it('serializes concurrent operations on the same repoId', async () => {
    const order: number[] = []
    const slow = async (n: number): Promise<void> => {
      await withRepoLock('shared-repo', async () => {
        order.push(n)
        await new Promise((resolve) => setTimeout(resolve, 10))
        order.push(-n)
      })
    }

    await Promise.all([slow(1), slow(2), slow(3)])

    // Each operation's start/end pair must be contiguous — no interleaving.
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i + 1]).toBe(-order[i])
    }
  })

  it('allows concurrent operations on different repoIds', async () => {
    const start = Date.now()
    await Promise.all([
      withRepoLock('repo-a', () => new Promise((resolve) => setTimeout(resolve, 30))),
      withRepoLock('repo-b', () => new Promise((resolve) => setTimeout(resolve, 30))),
    ])
    // If serialized, this would take ~60ms; concurrent should be ~30ms.
    expect(Date.now() - start).toBeLessThan(55)
  })
})
