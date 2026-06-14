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
import { openDatabaseAt, withDbSession, closeSessionAtPath, type DbSession } from '../src/core/db/sqlite.js'
import { storeBlob } from '../src/core/indexing/blobStore.js'
import { SqliteStorageProfile } from '../src/core/storage/sqlite/profile.js'
import { resolveStorageProfile, resolveSqliteDbPath, withStorageProfile } from '../src/core/storage/resolveProfile.js'
import type { CommitEntry } from '../src/core/git/commitMap.js'

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

describe('SqliteStorageProfile — write-path conformance (Phase 102)', () => {
  let dir: string
  let session: DbSession
  const model = 'mock-model'
  const profile = new SqliteStorageProfile('project', ':memory:')

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitsema-storage-write-'))
    session = openDatabaseAt(join(dir, 'index.db'))
  })

  afterAll(() => {
    session.rawDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('MetadataStore.putBlob / addPath register a blob and its paths', async () => {
    await withDbSession(session, async () => {
      await profile.metadata.putBlob('e'.repeat(40), 42)
      await profile.metadata.addPath('e'.repeat(40), 'src/new.ts')
      await profile.metadata.addPath('e'.repeat(40), 'lib/new.ts')
      const map = await profile.metadata.pathsFor(['e'.repeat(40)])
      expect(new Set(map.get('e'.repeat(40)))).toEqual(new Set(['src/new.ts', 'lib/new.ts']))
      expect(await profile.metadata.isIndexed('e'.repeat(40), model)).toBe(false)
    })
  })

  it('MetadataStore.putCommit / linkBlobCommits links only indexed blobs', async () => {
    await withDbSession(session, async () => {
      const commit: CommitEntry = {
        commitHash: 'c'.repeat(40),
        timestamp: 1000,
        message: 'add feature',
        authorName: 'Alice',
        authorEmail: 'alice@example.com',
        branches: [],
      }
      await profile.metadata.putCommit(commit)
      // 'e'.repeat(40) is registered (from putBlob above); 'f'.repeat(40) is not yet.
      const linked = await profile.metadata.linkBlobCommits('c'.repeat(40), ['e'.repeat(40), 'f'.repeat(40)])
      expect(linked).toBe(1)
      // calling again is idempotent (onConflictDoNothing)
      const linkedAgain = await profile.metadata.linkBlobCommits('c'.repeat(40), ['e'.repeat(40)])
      expect(linkedAgain).toBe(0)
    })
  })

  it('MetadataStore.setBlobBranches records branch associations', async () => {
    await withDbSession(session, async () => {
      await profile.metadata.setBlobBranches('e'.repeat(40), ['main', 'feature/x'])
      const rows = session.rawDb
        .prepare('SELECT branch_name FROM blob_branches WHERE blob_hash = ? ORDER BY branch_name')
        .all('e'.repeat(40)) as Array<{ branch_name: string }>
      expect(rows.map((r) => r.branch_name)).toEqual(['feature/x', 'main'])
    })
  })

  it('MetadataStore.markCommitIndexed / getLastIndexedCommit track progress', async () => {
    await withDbSession(session, async () => {
      expect(await profile.metadata.getLastIndexedCommit()).toBeUndefined()
      await profile.metadata.markCommitIndexed('c'.repeat(40))
      expect(await profile.metadata.getLastIndexedCommit()).toBe('c'.repeat(40))
    })
  })

  it('VectorStore.upsert/delete for file embeddings', async () => {
    await withDbSession(session, async () => {
      await profile.vectors.upsert('file', [{ id: 'e'.repeat(40), model, dimensions: 8, embedding: unitVec(5) }])
      expect(await profile.vectors.countFileEmbeddings(model)).toBe(1)
      const results = await profile.vectors.search(unitVec(5), { topK: 5, model })
      expect(results.map((r) => r.blobHash)).toContain('e'.repeat(40))
      await profile.vectors.delete('file', ['e'.repeat(40)])
      expect(await profile.vectors.countFileEmbeddings(model)).toBe(0)
    })
  })

  it('VectorStore.upsert/delete for chunk embeddings', async () => {
    await withDbSession(session, async () => {
      await profile.vectors.upsert('chunk', [{ id: 'e'.repeat(40), model, dimensions: 8, embedding: unitVec(6), startLine: 1, endLine: 10 }])
      const chunkRows = () => session.rawDb.prepare('SELECT id FROM chunks WHERE blob_hash = ?').all('e'.repeat(40)) as unknown[]
      expect(chunkRows().length).toBe(1)
      await profile.vectors.delete('chunk', ['e'.repeat(40)])
      expect(chunkRows().length).toBe(0)
    })
  })

  it('VectorStore.upsert/delete for symbol embeddings', async () => {
    await withDbSession(session, async () => {
      await profile.vectors.upsert('symbol', [{
        id: 'e'.repeat(40), model, dimensions: 8, embedding: unitVec(7),
        startLine: 1, endLine: 5, symbolName: 'doThing', symbolKind: 'function', language: 'typescript',
      }])
      const symbolRows = () => session.rawDb.prepare('SELECT id FROM symbols WHERE blob_hash = ?').all('e'.repeat(40)) as unknown[]
      expect(symbolRows().length).toBe(1)
      await profile.vectors.delete('symbol', ['e'.repeat(40)])
      expect(symbolRows().length).toBe(0)
    })
  })

  it('VectorStore.upsert/delete for module embeddings', async () => {
    await withDbSession(session, async () => {
      await profile.vectors.upsert('module', [{ id: 'src', model, dimensions: 8, embedding: unitVec(8), blobCount: 3 }])
      const moduleRows = () => session.rawDb.prepare('SELECT module_path FROM module_embeddings WHERE module_path = ?').all('src') as unknown[]
      expect(moduleRows().length).toBe(1)
      await profile.vectors.delete('module', ['src'])
      expect(moduleRows().length).toBe(0)
    })
  })

  it('VectorStore.upsert/delete for commit embeddings', async () => {
    await withDbSession(session, async () => {
      await profile.vectors.upsert('commit', [{ id: 'c'.repeat(40), model, dimensions: 8, embedding: unitVec(9) }])
      const commitRows = () => session.rawDb.prepare('SELECT commit_hash FROM commit_embeddings WHERE commit_hash = ?').all('c'.repeat(40)) as unknown[]
      expect(commitRows().length).toBe(1)
      await profile.vectors.delete('commit', ['c'.repeat(40)])
      expect(commitRows().length).toBe(0)
    })
  })

  it('StorageProfile.writeFileBlob writes blob + embedding + path + fts atomically', async () => {
    await withDbSession(session, async () => {
      await profile.writeFileBlob({
        blobHash: 'f'.repeat(40), size: 12, path: 'src/atomic.ts', model,
        embedding: unitVec(10), content: 'atomic write test content',
      })
      expect(await profile.metadata.isIndexed('f'.repeat(40), model)).toBe(true)
      const map = await profile.metadata.pathsFor(['f'.repeat(40)])
      expect(map.get('f'.repeat(40))).toEqual(['src/atomic.ts'])
      expect(await profile.fts!.get('f'.repeat(40))).toContain('atomic write')
    })
  })

  it('StorageProfile.writeBlobRecord writes blob + path without an embedding', async () => {
    await withDbSession(session, async () => {
      await profile.writeBlobRecord({ blobHash: '1'.repeat(40), size: 3, path: 'src/noembed.ts' })
      const map = await profile.metadata.pathsFor(['1'.repeat(40)])
      expect(map.get('1'.repeat(40))).toEqual(['src/noembed.ts'])
      expect(await profile.metadata.isIndexed('1'.repeat(40), model)).toBe(false)
    })
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
  let dbPath: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitsema-withprofile-'))
    dbPath = join(dir, 'scoped.db')
  })
  afterAll(() => {
    // withStorageProfile opens a cached session via getOrOpenSessionAtPath;
    // close it before removing the dir or Windows fails with EBUSY (WAL lock).
    closeSessionAtPath(dbPath)
    rmSync(dir, { recursive: true, force: true })
  })

  it('routes the stores to the profile location', async () => {
    const profile = new SqliteStorageProfile('named', dbPath)
    await withStorageProfile(profile, async () => {
      storeBlob({ blobHash: 'd'.repeat(40), size: 5, path: 'x.ts', model: 'm', embedding: unitVec(3), content: 'scoped content sample' })
      expect(await profile.vectors.countFileEmbeddings()).toBe(1)
      const hits = await profile.fts!.search('scoped', 10)
      expect(hits.map((h) => h.blobHash)).toContain('d'.repeat(40))
    })
  })
})
