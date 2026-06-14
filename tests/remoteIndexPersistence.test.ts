/**
 * Integration tests for persistent server-side repo storage on
 * POST /api/v1/remote/index (default `persist: true`).
 *
 * Focus: repoId resolution/derivation, registry lookups, and
 * token-scoping enforcement in the route handler — not the full
 * clone/index pipeline (cloneRepo + indexer are mocked).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import request from 'supertest'

const dataDir = mkdtempSync(join(tmpdir(), 'gitsema-data-'))
process.env.GITSEMA_DATA_DIR = dataDir

vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  const session = actual.openDatabaseAt(':memory:')
  return {
    ...actual,
    getActiveSession: () => session,
    getRawDb: () => session.rawDb,
    db: session.db,
  }
})

vi.mock('../src/core/git/cloneRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/git/cloneRepo.js')>()
  return {
    ...actual,
    validateCloneUrl: vi.fn(async () => undefined),
    obtainClone: vi.fn(async () => ({ clonePath: '/fake/clone', fresh: true })),
    cleanupClone: vi.fn(async () => undefined),
    getCloneSemaphore: () => ({
      available: 1,
      acquire: async () => undefined,
      release: () => undefined,
    }),
  }
})

vi.mock('../src/core/indexing/indexer.js', () => ({
  runIndex: vi.fn(async () => ({ indexed: 0, skipped: 0, failed: 0 })),
}))

import { createApp } from '../src/server/app.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'
import { getRegistrySession, closeRegistrySession, normalizeRepoUrl, deriveRepoId, registerPersistedRepo, getRepoClonePath, getRepoDbPath } from '../src/core/indexing/repoRegistry.js'

const mockProvider: EmbeddingProvider = {
  model: 'mock',
  embed: async () => [0.1, 0.2, 0.3, 0.4],
  embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
  dimensions: 4,
}

let app: ReturnType<typeof createApp>

beforeAll(() => {
  app = createApp({ textProvider: mockProvider })
})

afterEach(() => {
  delete process.env.GITSEMA_SERVE_KEY
})

afterAll(() => {
  delete process.env.GITSEMA_DATA_DIR
  // Close the registry's sqlite handle first — on Windows, an open
  // WAL-mode database file cannot be unlinked while held open.
  closeRegistrySession()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('POST /api/v1/remote/index — persistence (default persist: true)', () => {
  it('derives and returns a stable repoId for a new repo URL', async () => {
    const repoUrl = 'https://github.com/example/new-repo.git'
    const res = await request(app)
      .post('/api/v1/remote/index')
      .send({ repoUrl })
      .expect(202)

    expect(res.body.jobId).toBeTruthy()
    expect(res.body.repoId).toBe(deriveRepoId(normalizeRepoUrl(repoUrl)))
  })

  it('reuses an existing repoId for an already-registered normalized URL', async () => {
    const repoUrl = 'https://github.com/example/existing-repo.git'
    const normalizedUrl = normalizeRepoUrl(repoUrl)
    const repoId = deriveRepoId(normalizedUrl)

    registerPersistedRepo(getRegistrySession(), {
      id: repoId,
      name: 'existing-repo',
      url: repoUrl,
      normalizedUrl,
      clonePath: getRepoClonePath(repoId),
      dbPath: getRepoDbPath(repoId),
    })

    const res = await request(app)
      .post('/api/v1/remote/index')
      .send({ repoUrl: 'https://token:secret@github.com/example/existing-repo.git' })
      .expect(202)

    expect(res.body.repoId).toBe(repoId)
  })

  it('returns 404 when an explicit repoId is not registered', async () => {
    const res = await request(app)
      .post('/api/v1/remote/index')
      .send({ repoUrl: 'https://github.com/example/some-repo.git', repoId: 'deadbeefdeadbeef' })
      .expect(404)

    expect(res.body.error).toMatch(/not found/)
  })

  it('returns 409 when an explicit repoId does not match the repoUrl', async () => {
    const repoUrl = 'https://github.com/example/mismatch-repo.git'
    const normalizedUrl = normalizeRepoUrl(repoUrl)
    const repoId = deriveRepoId(normalizedUrl)

    registerPersistedRepo(getRegistrySession(), {
      id: repoId,
      name: 'mismatch-repo',
      url: repoUrl,
      normalizedUrl,
      clonePath: getRepoClonePath(repoId),
      dbPath: getRepoDbPath(repoId),
    })

    const res = await request(app)
      .post('/api/v1/remote/index')
      .send({ repoUrl: 'https://github.com/example/different-repo.git', repoId })
      .expect(409)

    expect(res.body.error).toMatch(/does not match/)
  })

  it('supports persist: false for ephemeral indexing without registry side effects', async () => {
    const repoUrl = 'https://github.com/example/ephemeral-repo.git'
    const res = await request(app)
      .post('/api/v1/remote/index')
      .send({ repoUrl, persist: false })
      .expect(202)

    expect(res.body.jobId).toBeTruthy()
    expect(res.body.repoId).toBeUndefined()
  })
})

describe('POST /api/v1/remote/index — token scoping', () => {
  afterEach(() => {
    delete process.env.GITSEMA_SERVE_KEY
  })

  it('rejects a scoped token registering a new repo', async () => {
    process.env.GITSEMA_SERVE_KEY = 'global-secret'
    const repoUrl = 'https://github.com/example/scoped-new-repo.git'
    const normalizedUrl = normalizeRepoUrl(repoUrl)
    const repoId = deriveRepoId(normalizedUrl)

    // Mint a scoped token for a *different* repo so req.repoId is set but
    // doesn't match the (not-yet-registered) repo for this request.
    const { getRawDb } = await import('../src/core/db/sqlite.js')
    const rawDb = getRawDb()
    const otherRepoId = 'aaaaaaaaaaaaaaaa'
    registerPersistedRepo(getRegistrySession(), {
      id: otherRepoId,
      name: 'other-repo',
      url: 'https://github.com/example/other-repo.git',
      normalizedUrl: normalizeRepoUrl('https://github.com/example/other-repo.git'),
      clonePath: getRepoClonePath(otherRepoId),
      dbPath: getRepoDbPath(otherRepoId),
    })
    const { createHash } = await import('node:crypto')
    const token = 'scoped-token-value'
    const tokenHash = createHash('sha256').update(token).digest('hex')
    // repo_tokens has a FK to repos(id) in this (in-memory) DB.
    rawDb.prepare('INSERT INTO repos (id, name, added_at) VALUES (?, ?, ?)')
      .run(otherRepoId, 'other-repo', Math.floor(Date.now() / 1000))
    rawDb.prepare('INSERT INTO repo_tokens (token_hash, token_prefix, repo_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(tokenHash, token.slice(0, 8), otherRepoId, 'test', Math.floor(Date.now() / 1000))

    const res = await request(app)
      .post('/api/v1/remote/index')
      .set('Authorization', `Bearer ${token}`)
      .send({ repoUrl })
      .expect(403)

    expect(res.body.error).toMatch(/not authorized|cannot register/i)
    expect(repoId).toBeTruthy() // sanity: repoId derivation didn't throw
  })
})
