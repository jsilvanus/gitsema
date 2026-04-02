import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../src/core/db/schema.js'
import { withDbSession } from '../src/core/db/sqlite.js'
import {
  getCachedQueryEmbedding,
  setCachedQueryEmbedding,
  pruneQueryEmbeddingCache,
} from '../src/core/embedding/queryCache.js'

// ---------------------------------------------------------------------------
// Helpers — create an in-memory DB with the query_embeddings table
// ---------------------------------------------------------------------------

function createTestSession() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS blobs (
      blob_hash TEXT PRIMARY KEY, size INTEGER NOT NULL, indexed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      blob_hash TEXT PRIMARY KEY REFERENCES blobs(blob_hash),
      model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, file_type TEXT
    );
    CREATE TABLE IF NOT EXISTS paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash), path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commits (
      commit_hash TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, message TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS blob_commits (
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      commit_hash TEXT NOT NULL REFERENCES commits(commit_hash),
      PRIMARY KEY (blob_hash, commit_hash)
    );
    CREATE TABLE IF NOT EXISTS indexed_commits (
      commit_hash TEXT PRIMARY KEY, indexed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id),
      model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS blob_fts USING fts5(
      blob_hash UNINDEXED, content, tokenize='porter ascii'
    );
    CREATE TABLE IF NOT EXISTS blob_branches (
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      branch_name TEXT NOT NULL,
      PRIMARY KEY (blob_hash, branch_name)
    );
    CREATE TABLE IF NOT EXISTS query_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_text TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      cached_at INTEGER NOT NULL,
      UNIQUE (query_text, model)
    );
  `)
  const db = drizzle(sqlite, { schema })
  return { db, rawDb: sqlite, dbPath: ':memory:' }
}

// ---------------------------------------------------------------------------
// getCachedQueryEmbedding / setCachedQueryEmbedding
// ---------------------------------------------------------------------------

describe('setCachedQueryEmbedding / getCachedQueryEmbedding', () => {
  it('returns null for a cache miss', async () => {
    const session = createTestSession()
    await withDbSession(session, async () => {
      const result = getCachedQueryEmbedding('hello world', 'nomic-embed-text')
      expect(result).toBeNull()
    })
  })

  it('stores and retrieves an embedding', async () => {
    const session = createTestSession()
    const embedding = [0.1, 0.2, 0.3, 0.4]
    await withDbSession(session, async () => {
      setCachedQueryEmbedding('hello world', 'nomic-embed-text', embedding)
      const result = getCachedQueryEmbedding('hello world', 'nomic-embed-text')
      expect(result).not.toBeNull()
      expect(result).toHaveLength(4)
      for (let i = 0; i < embedding.length; i++) {
        expect(result![i]).toBeCloseTo(embedding[i])
      }
    })
  })

  it('separates entries by model', async () => {
    const session = createTestSession()
    const embA = [1, 0, 0]
    const embB = [0, 1, 0]
    await withDbSession(session, async () => {
      setCachedQueryEmbedding('query', 'model-a', embA)
      setCachedQueryEmbedding('query', 'model-b', embB)

      const resultA = getCachedQueryEmbedding('query', 'model-a')
      const resultB = getCachedQueryEmbedding('query', 'model-b')

      expect(resultA![0]).toBeCloseTo(1)
      expect(resultA![1]).toBeCloseTo(0)
      expect(resultB![0]).toBeCloseTo(0)
      expect(resultB![1]).toBeCloseTo(1)
    })
  })

  it('updates the vector on repeat set (upsert)', async () => {
    const session = createTestSession()
    await withDbSession(session, async () => {
      setCachedQueryEmbedding('query', 'model', [0.1, 0.2])
      setCachedQueryEmbedding('query', 'model', [0.9, 0.8])
      const result = getCachedQueryEmbedding('query', 'model')
      expect(result![0]).toBeCloseTo(0.9)
      expect(result![1]).toBeCloseTo(0.8)
    })
  })

  it('isolates results by query_text', async () => {
    const session = createTestSession()
    await withDbSession(session, async () => {
      setCachedQueryEmbedding('query one', 'model', [1, 0])
      setCachedQueryEmbedding('query two', 'model', [0, 1])

      const r1 = getCachedQueryEmbedding('query one', 'model')
      const r2 = getCachedQueryEmbedding('query two', 'model')

      expect(r1![0]).toBeCloseTo(1)
      expect(r2![0]).toBeCloseTo(0)
      expect(r2![1]).toBeCloseTo(1)
    })
  })
})

// ---------------------------------------------------------------------------
// pruneQueryEmbeddingCache
// ---------------------------------------------------------------------------

describe('pruneQueryEmbeddingCache', () => {
  it('removes entries older than the TTL', async () => {
    const session = createTestSession()
    await withDbSession(session, async () => {
      // Insert an entry with a very old cached_at
      session.rawDb.prepare(
        `INSERT INTO query_embeddings (query_text, model, dimensions, vector, cached_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('old query', 'model', 3, Buffer.alloc(12), Date.now() - 10_000)

      // Insert a fresh entry
      setCachedQueryEmbedding('fresh query', 'model', [0.1, 0.2, 0.3])

      // Prune with a 5 second TTL — the old entry should be removed
      const removed = pruneQueryEmbeddingCache(10_000, 5_000)
      expect(removed).toBeGreaterThanOrEqual(1)

      expect(getCachedQueryEmbedding('old query', 'model')).toBeNull()
      expect(getCachedQueryEmbedding('fresh query', 'model')).not.toBeNull()
    })
  })

  it('caps the cache at maxEntries', async () => {
    const session = createTestSession()
    await withDbSession(session, async () => {
      // Insert 5 entries, each progressively newer
      for (let i = 0; i < 5; i++) {
        session.rawDb.prepare(
          `INSERT INTO query_embeddings (query_text, model, dimensions, vector, cached_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(`query ${i}`, 'model', 3, Buffer.alloc(12), Date.now() + i)
      }

      const rowsBefore = (
        session.rawDb.prepare('SELECT COUNT(*) as c FROM query_embeddings').get() as { c: number }
      ).c
      expect(rowsBefore).toBe(5)

      // Prune to max 3 entries (no TTL expiry — use a far future cutoff)
      pruneQueryEmbeddingCache(3, 999_999_999_999)

      const rowsAfter = (
        session.rawDb.prepare('SELECT COUNT(*) as c FROM query_embeddings').get() as { c: number }
      ).c
      expect(rowsAfter).toBe(3)
    })
  })

  it('returns 0 when nothing to prune', async () => {
    const session = createTestSession()
    await withDbSession(session, async () => {
      setCachedQueryEmbedding('query', 'model', [1, 2, 3])
      const removed = pruneQueryEmbeddingCache(1_000, 999_999_999_999)
      expect(removed).toBe(0)
    })
  })
})
