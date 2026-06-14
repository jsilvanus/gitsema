/**
 * Phase 102 — Postgres storage adapter conformance.
 *
 * Mirrors `tests/storageProfile.test.ts` against a real Postgres + pgvector
 * instance. Gated on `GITSEMA_TEST_POSTGRES_URL` (set by CI's
 * `postgres-storage-tests` job, or locally via
 * `docker-compose.postgres.yml` — see that file for setup).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgresStorageProfile } from '../src/core/storage/postgres/profile.js'
import { getPgPool, closeAllPgPools } from '../src/core/storage/postgres/connection.js'
import { resolveStorageProfile, withStorageProfile } from '../src/core/storage/resolveProfile.js'
import type { CommitEntry } from '../src/core/git/commitMap.js'

function unitVec(seed: number, dim = 8): number[] {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1) * 0.7))
  const mag = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1
  return raw.map((x) => x / mag)
}

const PG_URL = process.env.GITSEMA_TEST_POSTGRES_URL

describe.skipIf(!PG_URL)('PostgresStorageProfile — adapter conformance (Phase 102)', () => {
  const model = 'mock-model'
  const profile = new PostgresStorageProfile('project', PG_URL!)

  beforeAll(async () => {
    const pool = getPgPool(PG_URL!)
    await profile.writeFileBlob({ blobHash: 'a'.repeat(40), size: 20, path: 'src/auth.ts', model, embedding: unitVec(1), content: 'function authenticate user login session' })
    await profile.writeFileBlob({ blobHash: 'b'.repeat(40), size: 20, path: 'src/db.ts', model, embedding: unitVec(2), content: 'open sqlite database connection pool' })
    await profile.metadata.addPath('a'.repeat(40), 'lib/auth.ts')
    void pool
  })

  afterAll(async () => {
    const pool = getPgPool(PG_URL!)
    await pool.query(`
      TRUNCATE TABLE blob_fts, commit_embeddings, module_embeddings, symbol_embeddings, symbols,
        chunk_embeddings, chunks, embeddings, blob_branches, indexed_commits, blob_commits,
        paths, commits, blobs CASCADE
    `)
    await closeAllPgPools()
  })

  it('VectorStore.search returns ranked file results', async () => {
    const results = await profile.vectors.search(unitVec(1), { topK: 5, model })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].blobHash).toBe('a'.repeat(40))
  })

  it('VectorStore.countFileEmbeddings counts whole-file embeddings', async () => {
    expect(await profile.vectors.countFileEmbeddings()).toBe(2)
    expect(await profile.vectors.countFileEmbeddings(model)).toBe(2)
    expect(await profile.vectors.countFileEmbeddings('no-such-model')).toBe(0)
  })

  it('MetadataStore.isIndexed / filterNewBlobs reflect stored blobs', async () => {
    expect(await profile.metadata.isIndexed('a'.repeat(40), model)).toBe(true)
    expect(await profile.metadata.isIndexed('c'.repeat(40), model)).toBe(false)
    const fresh = await profile.metadata.filterNewBlobs(['a'.repeat(40), 'c'.repeat(40)], model)
    expect(fresh.has('c'.repeat(40))).toBe(true)
    expect(fresh.has('a'.repeat(40))).toBe(false)
  })

  it('MetadataStore.pathsFor returns all paths for a blob', async () => {
    const map = await profile.metadata.pathsFor(['a'.repeat(40)])
    expect(new Set(map.get('a'.repeat(40)))).toEqual(new Set(['src/auth.ts', 'lib/auth.ts']))
  })

  it('FtsStore.search / get round-trip via ts_rank_cd', async () => {
    const fts = profile.fts!
    const hits = await fts.search('authenticate', 10)
    expect(hits.map((h) => h.blobHash)).toContain('a'.repeat(40))
    expect(await fts.get('a'.repeat(40))).toContain('authenticate')
  })

  it('FtsStore.delete removes content', async () => {
    const fts = profile.fts!
    await fts.delete(['b'.repeat(40)])
    expect(await fts.get('b'.repeat(40))).toBeUndefined()
    const hits = await fts.search('sqlite', 10)
    expect(hits.map((h) => h.blobHash)).not.toContain('b'.repeat(40))
  })

  it('MetadataStore.putCommit / linkBlobCommits / setBlobBranches / markCommitIndexed', async () => {
    const commit: CommitEntry = {
      commitHash: 'c'.repeat(40),
      timestamp: 1000,
      message: 'add feature',
      authorName: 'Alice',
      authorEmail: 'alice@example.com',
      branches: [],
    }
    await profile.metadata.putCommit(commit)
    const linked = await profile.metadata.linkBlobCommits('c'.repeat(40), ['a'.repeat(40), 'd'.repeat(40)])
    expect(linked).toBe(1)
    expect(await profile.metadata.linkBlobCommits('c'.repeat(40), ['a'.repeat(40)])).toBe(0)

    await profile.metadata.setBlobBranches('a'.repeat(40), ['main', 'feature/x'])

    expect(await profile.metadata.getLastIndexedCommit()).toBeUndefined()
    await profile.metadata.markCommitIndexed('c'.repeat(40))
    expect(await profile.metadata.getLastIndexedCommit()).toBe('c'.repeat(40))
  })

  it('VectorStore.upsert/delete for chunk/symbol/module/commit kinds', async () => {
    await profile.vectors.upsert('chunk', [{ id: 'a'.repeat(40), model, dimensions: 8, embedding: unitVec(6), startLine: 1, endLine: 10 }])
    await profile.vectors.upsert('symbol', [{
      id: 'a'.repeat(40), model, dimensions: 8, embedding: unitVec(7),
      startLine: 1, endLine: 5, symbolName: 'doThing', symbolKind: 'function', language: 'typescript',
    }])
    await profile.vectors.upsert('module', [{ id: 'src', model, dimensions: 8, embedding: unitVec(8), blobCount: 3 }])
    await profile.vectors.upsert('commit', [{ id: 'c'.repeat(40), model, dimensions: 8, embedding: unitVec(9) }])

    const chunkResults = await profile.vectors.search(unitVec(6), { topK: 5, model, searchChunks: true })
    expect(chunkResults.some((r) => r.kind === 'chunk' && r.blobHash === 'a'.repeat(40))).toBe(true)

    const symbolResults = await profile.vectors.search(unitVec(7), { topK: 5, model, searchSymbols: true })
    expect(symbolResults.some((r) => r.kind === 'symbol' && r.symbolName === 'doThing')).toBe(true)

    const moduleResults = await profile.vectors.search(unitVec(8), { topK: 5, model, searchModules: true })
    expect(moduleResults.some((r) => r.kind === 'module' && r.modulePath === 'src')).toBe(true)

    const commitResults = await profile.vectors.searchCommits(unitVec(9), { topK: 5, model })
    expect(commitResults.some((r) => r.commitHash === 'c'.repeat(40))).toBe(true)

    await profile.vectors.delete('chunk', ['a'.repeat(40)])
    await profile.vectors.delete('symbol', ['a'.repeat(40)])
    await profile.vectors.delete('module', ['src'])
    await profile.vectors.delete('commit', ['c'.repeat(40)])

    const afterDelete = await profile.vectors.search(unitVec(6), { topK: 5, model, searchChunks: true })
    expect(afterDelete.some((r) => r.kind === 'chunk')).toBe(false)
  })

  it('StorageProfile.writeBlobRecord writes blob + path without an embedding', async () => {
    await profile.writeBlobRecord({ blobHash: '1'.repeat(40), size: 3, path: 'src/noembed.ts' })
    const map = await profile.metadata.pathsFor(['1'.repeat(40)])
    expect(map.get('1'.repeat(40))).toEqual(['src/noembed.ts'])
    expect(await profile.metadata.isIndexed('1'.repeat(40), model)).toBe(false)
  })
})

describe.skipIf(!PG_URL)('resolveStorageProfile / withStorageProfile — postgres backend', () => {
  afterAll(async () => {
    await closeAllPgPools()
  })

  it('resolves a PostgresStorageProfile and runs work via withStorageProfile', async () => {
    const prevBackend = process.env.GITSEMA_STORAGE_BACKEND
    const prevUrl = process.env.GITSEMA_STORAGE_METADATA_URL
    process.env.GITSEMA_STORAGE_BACKEND = 'postgres'
    process.env.GITSEMA_STORAGE_METADATA_URL = PG_URL!
    try {
      const profile = resolveStorageProfile(process.cwd())
      expect(profile.backend).toBe('postgres')
      await withStorageProfile(profile, async () => {
        await profile.metadata.putBlob('e'.repeat(40), 1)
        expect(await profile.metadata.isIndexed('e'.repeat(40), 'm')).toBe(false)
      })
    } finally {
      if (prevBackend === undefined) delete process.env.GITSEMA_STORAGE_BACKEND
      else process.env.GITSEMA_STORAGE_BACKEND = prevBackend
      if (prevUrl === undefined) delete process.env.GITSEMA_STORAGE_METADATA_URL
      else process.env.GITSEMA_STORAGE_METADATA_URL = prevUrl
      const pool = getPgPool(PG_URL!)
      await pool.query("DELETE FROM blobs WHERE blob_hash = $1", ['e'.repeat(40)])
    }
  })
})
