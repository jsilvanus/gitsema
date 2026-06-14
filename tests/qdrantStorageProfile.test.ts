/**
 * Phase 103 — Qdrant storage adapter conformance.
 *
 * Mirrors `tests/postgresStorageProfile.test.ts` against a real Qdrant +
 * Postgres companion instance. Gated on `GITSEMA_TEST_QDRANT_URL` and
 * `GITSEMA_TEST_POSTGRES_URL` (set by CI's `qdrant-storage-tests` job, or
 * locally via `docker-compose.qdrant.yml` — see that file for setup).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { QdrantStorageProfile } from '../src/core/storage/qdrant/profile.js'
import { getPgPool, closeAllPgPools } from '../src/core/storage/postgres/connection.js'
import { clearQdrantClients, getQdrantClient } from '../src/core/storage/qdrant/connection.js'
import { resolveStorageProfile, withStorageProfile } from '../src/core/storage/resolveProfile.js'
import type { CommitEntry } from '../src/core/git/commitMap.js'

function unitVec(seed: number, dim = 8): number[] {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1) * 0.7))
  const mag = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1
  return raw.map((x) => x / mag)
}

const QDRANT_URL = process.env.GITSEMA_TEST_QDRANT_URL
const PG_URL = process.env.GITSEMA_TEST_POSTGRES_URL

async function dropGitsemaCollections(): Promise<void> {
  const client = getQdrantClient(QDRANT_URL!)
  const { collections } = await client.getCollections()
  for (const c of collections) {
    if (c.name.startsWith('gitsema_')) await client.deleteCollection(c.name)
  }
}

describe.skipIf(!QDRANT_URL || !PG_URL)('QdrantStorageProfile — adapter conformance (Phase 103)', () => {
  const model = 'mock-model'
  const profile = new QdrantStorageProfile('project', QDRANT_URL!, PG_URL!)

  beforeAll(async () => {
    await dropGitsemaCollections()
    await profile.writeFileBlob({ blobHash: 'a'.repeat(40), size: 20, path: 'src/auth.ts', model, embedding: unitVec(1), content: 'function authenticate user login session' })
    await profile.writeFileBlob({ blobHash: 'b'.repeat(40), size: 20, path: 'src/db.ts', model, embedding: unitVec(2), content: 'open sqlite database connection pool' })
    await profile.metadata.addPath('a'.repeat(40), 'lib/auth.ts')
  })

  afterAll(async () => {
    const pool = getPgPool(PG_URL!)
    await pool.query(`
      TRUNCATE TABLE blob_fts, commit_embeddings, module_embeddings, symbol_embeddings, symbols,
        chunk_embeddings, chunks, embeddings, blob_branches, indexed_commits, blob_commits,
        paths, commits, blobs CASCADE
    `)
    await dropGitsemaCollections()
    await closeAllPgPools()
    clearQdrantClients()
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
    expect(await profile.metadata.isIndexed('a'.repeat(40), model)).toBe(false)
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

  it('MetadataStore.getStats reports row counts', async () => {
    const stats = await profile.metadata.getStats()
    expect(stats.blobCount).toBe(2)
    expect(stats.pathCount).toBe(3)
    expect(stats.commitCount).toBe(1)
    expect(stats.indexedCommitCount).toBe(1)
    expect(stats.branchCount).toBe(2)
    expect(stats.lastIndexedCommit).toBe('c'.repeat(40))
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

describe.skipIf(!QDRANT_URL || !PG_URL)('resolveStorageProfile / withStorageProfile — qdrant backend', () => {
  afterAll(async () => {
    await dropGitsemaCollections()
    await closeAllPgPools()
    clearQdrantClients()
  })

  it('resolves a QdrantStorageProfile and runs work via withStorageProfile', async () => {
    const prev = {
      backend: process.env.GITSEMA_STORAGE_BACKEND,
      metadataUrl: process.env.GITSEMA_STORAGE_METADATA_URL,
      vectorsUrl: process.env.GITSEMA_STORAGE_VECTORS_URL,
    }
    process.env.GITSEMA_STORAGE_BACKEND = 'qdrant'
    process.env.GITSEMA_STORAGE_METADATA_URL = PG_URL!
    process.env.GITSEMA_STORAGE_VECTORS_URL = QDRANT_URL!
    try {
      const profile = resolveStorageProfile(process.cwd())
      expect(profile.backend).toBe('qdrant')
      await withStorageProfile(profile, async () => {
        await profile.metadata.putBlob('e'.repeat(40), 1)
        expect(await profile.metadata.isIndexed('e'.repeat(40), 'm')).toBe(false)
      })
    } finally {
      for (const [k, v] of Object.entries({
        GITSEMA_STORAGE_BACKEND: prev.backend,
        GITSEMA_STORAGE_METADATA_URL: prev.metadataUrl,
        GITSEMA_STORAGE_VECTORS_URL: prev.vectorsUrl,
      })) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      const pool = getPgPool(PG_URL!)
      await pool.query("DELETE FROM blobs WHERE blob_hash = $1", ['e'.repeat(40)])
    }
  })
})
