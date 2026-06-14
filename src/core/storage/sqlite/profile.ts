/**
 * SQLite-backed implementation of the storage seam (Phase 101).
 *
 * Each store delegates to the existing synchronous better-sqlite3 code via the
 * active DbSession, wrapped in resolved promises. The stores are stateless and
 * resolve `getActiveSession()` lazily on every call, so they cooperate with
 * `withDbSession()` contexts exactly like the rest of the codebase. This means
 * adopting the seam in a call site is behavior-preserving.
 */

import { getActiveSession } from '../../db/sqlite.js'
import { embeddings, paths } from '../../db/schema.js'
import { eq, inArray, sql } from 'drizzle-orm'
import { isIndexed as dedupeIsIndexed, filterNewBlobs as dedupeFilterNewBlobs } from '../../indexing/deduper.js'
import { storeFtsContent, getBlobContent } from '../../indexing/blobStore.js'
import { vectorSearch, type VectorSearchOptions } from '../../search/analysis/vectorSearch.js'
import { searchCommits, type CommitSearchOptions, type CommitSearchResult } from '../../search/commitSearch.js'
import type { Embedding, SearchResult } from '../../models/types.js'
import type {
  Bm25Hit,
  FtsStore,
  MetadataStore,
  StorageProfile,
  StorageScope,
  VectorStore,
} from '../types.js'

class SqliteMetadataStore implements MetadataStore {
  async isIndexed(blobHash: string, model: string): Promise<boolean> {
    return dedupeIsIndexed(blobHash, model)
  }

  async filterNewBlobs(hashes: string[], model: string): Promise<Set<string>> {
    return dedupeFilterNewBlobs(hashes, model)
  }

  async pathsFor(blobHashes: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    if (blobHashes.length === 0) return result
    const { db } = getActiveSession()
    const BATCH = 500
    for (let i = 0; i < blobHashes.length; i += BATCH) {
      const batch = blobHashes.slice(i, i + BATCH)
      const rows = db
        .select({ blobHash: paths.blobHash, path: paths.path })
        .from(paths)
        .where(inArray(paths.blobHash, batch))
        .all()
      for (const row of rows) {
        const list = result.get(row.blobHash) ?? []
        list.push(row.path)
        result.set(row.blobHash, list)
      }
    }
    return result
  }
}

class SqliteVectorStore implements VectorStore {
  async search(queryEmbedding: Embedding, options: VectorSearchOptions = {}): Promise<SearchResult[]> {
    return await vectorSearch(queryEmbedding, options)
  }

  async searchCommits(queryEmbedding: Embedding, options: CommitSearchOptions = {}): Promise<CommitSearchResult[]> {
    return await searchCommits(queryEmbedding, options)
  }

  async countFileEmbeddings(model?: string): Promise<number> {
    const { db } = getActiveSession()
    const base = db.select({ n: sql<number>`count(*)` }).from(embeddings)
    const row = model ? base.where(eq(embeddings.model, model)).get() : base.get()
    return row?.n ?? 0
  }
}

class SqliteFtsStore implements FtsStore {
  async index(blobHash: string, content: string): Promise<void> {
    storeFtsContent(blobHash, content)
  }

  async get(blobHash: string): Promise<string | undefined> {
    return getBlobContent(blobHash)
  }

  async search(query: string, limit: number): Promise<Bm25Hit[]> {
    const { rawDb } = getActiveSession()
    try {
      const rows = rawDb
        .prepare(
          `SELECT blob_hash, bm25(blob_fts) AS bm25_score
           FROM blob_fts
           WHERE blob_fts MATCH ?
           ORDER BY bm25_score
           LIMIT ?`,
        )
        .all(sanitizeFtsQuery(query), limit) as Array<{ blob_hash: string; bm25_score: number }>
      return rows.map((r) => ({ blobHash: r.blob_hash, score: r.bm25_score }))
    } catch {
      // FTS5 unavailable or query un-parseable — treat as no keyword hits.
      return []
    }
  }

  async delete(blobHashes: string[]): Promise<void> {
    if (blobHashes.length === 0) return
    const { rawDb } = getActiveSession()
    const stmt = rawDb.prepare('DELETE FROM blob_fts WHERE blob_hash = ?')
    const tx = rawDb.transaction((hashes: string[]) => {
      for (const h of hashes) stmt.run(h)
    })
    tx(blobHashes)
  }
}

/**
 * Builds an FTS5 MATCH expression from a free-text query by quoting each token
 * as a phrase (mirrors the sanitisation used by the existing hybrid search).
 */
export function sanitizeFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ')
}

/**
 * A SQLite storage profile. The three stores share the active DbSession, so
 * wrapping calls in `withStorageProfile()` (which activates the profile's
 * database) routes all three to the same SQLite file.
 */
export class SqliteStorageProfile implements StorageProfile {
  readonly backend = 'sqlite' as const
  readonly metadata: MetadataStore = new SqliteMetadataStore()
  readonly vectors: VectorStore = new SqliteVectorStore()
  readonly fts: FtsStore | null

  constructor(
    readonly scope: StorageScope,
    readonly location: string,
    ftsEnabled = true,
  ) {
    this.fts = ftsEnabled ? new SqliteFtsStore() : null
  }
}
