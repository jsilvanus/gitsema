/**
 * Postgres-backed `FtsStore` (Phase 102).
 *
 * Default keyword ranking uses `tsvector` + `ts_rank_cd` (zero extra
 * extensions). When `storage.fts.backend=pg_search` is configured, ranking
 * instead uses ParadeDB's `pg_search` BM25 scoring via the `@@@` operator and
 * `paradedb.score()` — opt-in because it requires the `pg_search` extension
 * and a BM25 index on `blob_fts`.
 *
 * `Bm25Hit.score` follows the same "lower is better" convention as the SQLite
 * FTS5 adapter (raw `bm25()` values are negative, more negative = better
 * match). Both `ts_rank_cd` and `paradedb.score()` are higher-is-better, so
 * this adapter negates them before returning — `hybridSearch`'s
 * `-hit.score` normalization then behaves identically across backends.
 * `ts_rank_cd` is an approximation of BM25, not an exact match for SQLite
 * FTS5's ranking; see docs/storage-backends-plan.md §11.
 */

import type { Pool } from 'pg'
import { ensurePostgresSchema } from './migrations.js'
import type { Bm25Hit, FtsStore } from '../types.js'

export type PostgresFtsBackend = 'tsvector' | 'pg_search'

export class PostgresFtsStore implements FtsStore {
  constructor(
    private readonly pool: Pool,
    private readonly backend: PostgresFtsBackend = 'tsvector',
  ) {}

  private async ready(): Promise<Pool> {
    await ensurePostgresSchema(this.pool)
    return this.pool
  }

  async index(blobHash: string, content: string): Promise<void> {
    const pool = await this.ready()
    await pool.query(
      `INSERT INTO blob_fts (blob_hash, content) VALUES ($1, $2)
       ON CONFLICT (blob_hash) DO UPDATE SET content = EXCLUDED.content`,
      [blobHash, content],
    )
  }

  async get(blobHash: string): Promise<string | undefined> {
    const pool = await this.ready()
    const { rows } = await pool.query<{ content: string }>(
      'SELECT content FROM blob_fts WHERE blob_hash = $1',
      [blobHash],
    )
    return rows[0]?.content
  }

  async search(query: string, limit: number): Promise<Bm25Hit[]> {
    const pool = await this.ready()
    try {
      if (this.backend === 'pg_search') {
        const { rows } = await pool.query<{ blob_hash: string; score: number }>(
          `SELECT blob_hash, paradedb.score(blob_hash) AS score
           FROM blob_fts
           WHERE blob_fts @@@ $1
           ORDER BY score DESC
           LIMIT $2`,
          [query, limit],
        )
        return rows.map((r) => ({ blobHash: r.blob_hash, score: -r.score }))
      }

      const { rows } = await pool.query<{ blob_hash: string; rank: number }>(
        `SELECT blob_hash, ts_rank_cd(tsv, websearch_to_tsquery('english', $1)) AS rank
         FROM blob_fts
         WHERE tsv @@ websearch_to_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2`,
        [query, limit],
      )
      return rows.map((r) => ({ blobHash: r.blob_hash, score: -r.rank }))
    } catch {
      // tsquery parse failure / pg_search extension unavailable — no keyword hits.
      return []
    }
  }

  async delete(blobHashes: string[]): Promise<void> {
    if (blobHashes.length === 0) return
    const pool = await this.ready()
    await pool.query('DELETE FROM blob_fts WHERE blob_hash = ANY($1)', [blobHashes])
  }
}
