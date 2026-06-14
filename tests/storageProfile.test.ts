/**
 * Phase 101 — storage seam.
 *
 * Conformance tests for the SQLite storage profile (MetadataStore / VectorStore
 * / FtsStore) exercised end-to-end against a real temp database, plus the
 * config-driven profile resolution and scope → path mapping.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import { storeBlob } from '../src/core/indexing/blobStore.js'
import { SqliteStorageProfile } from '../src/core/storage/sqlite/profile.js'
import { resolveStorageProfile, resolveSqliteDbPath, withStorageProfile } from '../src/core/storage/resolveProfile.js'

function unitVec(seed: number, dim = 8): number[] {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1) * 0.7))
  const mag = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1
  return raw.map((x) => x / mag)
}

const STORAGE_ENV = [
  'GITSEMA_STORAGE_BACKEND',
  'GITSEMA_STORAGE_SCOPE',
  'GITSEMA_STORAGE_NAME',
  'GITSEMA_STORAGE_METADATA_URL',
  'GITSEMA_STORAGE_FTS_BACKEND',
] as const

function clearStorageEnv(): void {
  for (const k of STORAGE_ENV) delete process.env[k]
}

describe('SqliteStorageProfile — store conformance', () => {
  let dir: string
  let session: DbSession
  const model = 'mock-model'
  const profile = new SqliteStorageProfile('project', ':memory:')

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gitsema-storage-'))
    session = openDatabaseAt(join(dir, 'index.db'))
    await withDbSession(session, async () => {
      storeBlob({ blobHash: 'a'.repeat(40), size: 20, path: 'src/auth.ts', model, embedding: unitVec(1), content: 'function authenticate user login session' })
      storeBlob({ blobHash: 'b'.repeat(40), size: 20, path: 'src/db.ts', model, embedding: unitVec(2), content: 'open sqlite database connection pool' })
      // second path for the same blob
      storeBlob({ blobHash: 'a'.repeat(40), size: 20, path: 'lib/auth.ts', model, embedding: unitVec(1), content: 'function authenticate user login session' })
    })
  })

  afterAll(() => {
    session.rawDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('VectorStore.search returns ranked file results', async () => {
    await withDbSession(session, async () => {
      const results = await profile.vectors.search(unitVec(1), { topK: 5, model })
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].blobHash).toBe('a'.repeat(40))
    })
  })

  it('VectorStore.countFileEmbeddings counts whole-file embeddings', async () => {
    await withDbSession(session, async () => {
      expect(await profile.vectors.countFileEmbeddings()).toBe(2)
      expect(await profile.vectors.countFileEmbeddings(model)).toBe(2)
      expect(await profile.vectors.countFileEmbeddings('no-such-model')).toBe(0)
    })
  })

  it('MetadataStore.isIndexed / filterNewBlobs reflect stored blobs', async () => {
    await withDbSession(session, async () => {
      expect(await profile.metadata.isIndexed('a'.repeat(40), model)).toBe(true)
      expect(await profile.metadata.isIndexed('c'.repeat(40), model)).toBe(false)
      const fresh = await profile.metadata.filterNewBlobs(['a'.repeat(40), 'c'.repeat(40)], model)
      expect(fresh.has('c'.repeat(40))).toBe(true)
      expect(fresh.has('a'.repeat(40))).toBe(false)
    })
  })

  it('MetadataStore.pathsFor returns all paths for a blob', async () => {
    await withDbSession(session, async () => {
      const map = await profile.metadata.pathsFor(['a'.repeat(40)])
      expect(new Set(map.get('a'.repeat(40)))).toEqual(new Set(['src/auth.ts', 'lib/auth.ts']))
    })
  })

  it('FtsStore.search / get round-trip via BM25', async () => {
    await withDbSession(session, async () => {
      const fts = profile.fts!
      const hits = await fts.search('authenticate', 10)
      expect(hits.map((h) => h.blobHash)).toContain('a'.repeat(40))
      expect(await fts.get('a'.repeat(40))).toContain('authenticate')
    })
  })

  it('FtsStore.delete removes content', async () => {
    await withDbSession(session, async () => {
      const fts = profile.fts!
      await fts.delete(['b'.repeat(40)])
      expect(await fts.get('b'.repeat(40))).toBeUndefined()
      const hits = await fts.search('sqlite', 10)
      expect(hits.map((h) => h.blobHash)).not.toContain('b'.repeat(40))
    })
  })

  it('null fts store disables keyword search', () => {
    const noFts = new SqliteStorageProfile('project', ':memory:', false)
    expect(noFts.fts).toBeNull()
  })
})

describe('resolveSqliteDbPath — scope → path', () => {
  it('project scope resolves under cwd/.gitsema', () => {
    expect(resolveSqliteDbPath('project', '/repo')).toBe(join('/repo', '.gitsema', 'index.db'))
  })

  it('user scope resolves under home', () => {
    expect(resolveSqliteDbPath('user', '/repo')).toBe(join(homedir(), '.gitsema', 'index.db'))
  })

  it('named scope requires and validates a name', () => {
    expect(resolveSqliteDbPath('named', '/repo', { name: 'team-mono' }))
      .toBe(join(homedir(), '.gitsema', 'named', 'team-mono.db'))
    expect(() => resolveSqliteDbPath('named', '/repo')).toThrow(/requires storage.name/)
    expect(() => resolveSqliteDbPath('named', '/repo', { name: '../evil' })).toThrow(/Invalid storage.name/)
  })

  it('explicit file metadata.url wins over scope default', () => {
    expect(resolveSqliteDbPath('project', '/repo', { metadataUrl: '/abs/custom.db' })).toBe('/abs/custom.db')
    expect(resolveSqliteDbPath('project', '/repo', { metadataUrl: 'rel/custom.db' })).toBe(join('/repo', 'rel', 'custom.db'))
  })
})

describe('resolveStorageProfile — config driven', () => {
  let cwd: string

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'gitsema-resolve-'))
  })
  afterAll(() => rmSync(cwd, { recursive: true, force: true }))
  afterEach(clearStorageEnv)

  it('defaults to sqlite + project scope', () => {
    const p = resolveStorageProfile(cwd)
    expect(p.backend).toBe('sqlite')
    expect(p.scope).toBe('project')
    expect(p.location).toBe(join(cwd, '.gitsema', 'index.db'))
    expect(p.fts).not.toBeNull()
  })

  it('storage.fts.backend=none yields a null fts store', () => {
    process.env.GITSEMA_STORAGE_FTS_BACKEND = 'none'
    expect(resolveStorageProfile(cwd).fts).toBeNull()
  })

  it('postgres and qdrant backends are not yet implemented', () => {
    process.env.GITSEMA_STORAGE_BACKEND = 'postgres'
    expect(() => resolveStorageProfile(cwd)).toThrow(/Phase 102/)
    process.env.GITSEMA_STORAGE_BACKEND = 'qdrant'
    expect(() => resolveStorageProfile(cwd)).toThrow(/Phase 103/)
  })

  it('invalid backend / scope are rejected', () => {
    process.env.GITSEMA_STORAGE_BACKEND = 'mongodb'
    expect(() => resolveStorageProfile(cwd)).toThrow(/Invalid storage.backend/)
    clearStorageEnv()
    process.env.GITSEMA_STORAGE_SCOPE = 'galaxy'
    expect(() => resolveStorageProfile(cwd)).toThrow(/Invalid storage.scope/)
  })
})

describe('withStorageProfile — activates the profile database', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitsema-withprofile-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('routes the stores to the profile location', async () => {
    const dbPath = join(dir, 'scoped.db')
    const profile = new SqliteStorageProfile('named', dbPath)
    await withStorageProfile(profile, async () => {
      storeBlob({ blobHash: 'd'.repeat(40), size: 5, path: 'x.ts', model: 'm', embedding: unitVec(3), content: 'scoped content sample' })
      expect(await profile.vectors.countFileEmbeddings()).toBe(1)
      const hits = await profile.fts!.search('scoped', 10)
      expect(hits.map((h) => h.blobHash)).toContain('d'.repeat(40))
    })
  })
})
