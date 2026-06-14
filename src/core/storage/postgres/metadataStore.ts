/**
 * Postgres-backed `MetadataStore` (Phase 102).
 *
 * Mirrors `SqliteMetadataStore` (src/core/storage/sqlite/profile.ts) against
 * the plain-SQL schema in `./migrations.ts`, using the `pg` driver directly.
 */

import type { Pool } from 'pg'
import { ensurePostgresSchema } from './migrations.js'
import type { CommitEntry } from '../../git/commitMap.js'
import type { MetadataStore } from '../types.js'

export class PostgresMetadataStore implements MetadataStore {
  constructor(private readonly pool: Pool) {}

  private async ready(): Promise<Pool> {
    await ensurePostgresSchema(this.pool)
    return this.pool
  }

  async isIndexed(blobHash: string, model: string): Promise<boolean> {
    const pool = await this.ready()
    const { rows } = await pool.query(
      'SELECT 1 FROM embeddings WHERE blob_hash = $1 AND model = $2 LIMIT 1',
      [blobHash, model],
    )
    return rows.length > 0
  }

  async filterNewBlobs(hashes: string[], model: string): Promise<Set<string>> {
    const result = new Set(hashes)
    if (hashes.length === 0) return result
    const pool = await this.ready()
    const { rows } = await pool.query<{ blob_hash: string }>(
      'SELECT blob_hash FROM embeddings WHERE model = $1 AND blob_hash = ANY($2)',
      [model, hashes],
    )
    for (const row of rows) result.delete(row.blob_hash)
    return result
  }

  async pathsFor(blobHashes: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    if (blobHashes.length === 0) return result
    const pool = await this.ready()
    const { rows } = await pool.query<{ blob_hash: string; path: string }>(
      'SELECT blob_hash, path FROM paths WHERE blob_hash = ANY($1)',
      [blobHashes],
    )
    for (const row of rows) {
      const list = result.get(row.blob_hash) ?? []
      list.push(row.path)
      result.set(row.blob_hash, list)
    }
    return result
  }

  async putBlob(blobHash: string, size: number): Promise<void> {
    const pool = await this.ready()
    await pool.query(
      'INSERT INTO blobs (blob_hash, size, indexed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [blobHash, size, Date.now()],
    )
  }

  async addPath(blobHash: string, path: string): Promise<void> {
    const pool = await this.ready()
    await pool.query(
      'INSERT INTO paths (blob_hash, path) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [blobHash, path],
    )
  }

  async putCommit(commit: CommitEntry): Promise<void> {
    const pool = await this.ready()
    await pool.query(
      `INSERT INTO commits (commit_hash, "timestamp", message, author_name, author_email)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [commit.commitHash, commit.timestamp, commit.message, commit.authorName ?? null, commit.authorEmail ?? null],
    )
  }

  async linkBlobCommits(commitHash: string, blobHashes: string[]): Promise<number> {
    const uniqueHashes = [...new Set(blobHashes)]
    if (uniqueHashes.length === 0) return 0

    const pool = await this.ready()

    // Only link blobs that are already indexed (mirrors storeCommitWithBlobs).
    const { rows: indexedRows } = await pool.query<{ blob_hash: string }>(
      'SELECT blob_hash FROM blobs WHERE blob_hash = ANY($1)',
      [uniqueHashes],
    )
    const indexedHashes = uniqueHashes.filter((h) => indexedRows.some((r) => r.blob_hash === h))
    if (indexedHashes.length === 0) return 0

    let linked = 0
    for (const blobHash of indexedHashes) {
      const res = await pool.query(
        'INSERT INTO blob_commits (blob_hash, commit_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [blobHash, commitHash],
      )
      linked += res.rowCount ?? 0
    }
    return linked
  }

  async setBlobBranches(blobHash: string, branches: string[]): Promise<void> {
    if (branches.length === 0) return
    const pool = await this.ready()
    const { rows } = await pool.query('SELECT 1 FROM blobs WHERE blob_hash = $1', [blobHash])
    if (rows.length === 0) return
    for (const branchName of branches) {
      await pool.query(
        'INSERT INTO blob_branches (blob_hash, branch_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [blobHash, branchName],
      )
    }
  }

  async markCommitIndexed(commitHash: string): Promise<void> {
    const pool = await this.ready()
    await pool.query(
      'INSERT INTO indexed_commits (commit_hash, indexed_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [commitHash, Date.now()],
    )
  }

  async getLastIndexedCommit(): Promise<string | undefined> {
    const pool = await this.ready()
    const { rows } = await pool.query<{ commit_hash: string }>(
      'SELECT commit_hash FROM indexed_commits ORDER BY indexed_at DESC LIMIT 1',
    )
    return rows[0]?.commit_hash
  }
}
