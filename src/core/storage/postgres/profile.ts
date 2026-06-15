/**
 * Postgres-backed `StorageProfile` (Phase 102).
 *
 * `location` is a `postgres://` connection string. The three stores share a
 * single connection pool (cached by connection string in `./connection.ts`),
 * mirroring how the SQLite stores share one `DbSession`.
 */

import { getPgPool } from './connection.js'
import { ensurePostgresSchema } from './migrations.js'
import { PostgresMetadataStore } from './metadataStore.js'
import { PostgresFtsStore, type PostgresFtsBackend } from './ftsStore.js'
import { PgVectorStore } from './vectorStore.js'
import { PostgresGraphStore } from './graphStore.js'
import type { FtsStore, GraphStore, MetadataStore, StorageProfile, StorageScope, VectorStore, WriteBlobRecordArgs, WriteFileBlobArgs } from '../types.js'

export class PostgresStorageProfile implements StorageProfile {
  readonly backend = 'postgres' as const
  readonly metadata: MetadataStore
  readonly vectors: VectorStore
  readonly fts: FtsStore | null
  readonly graph: GraphStore
  private readonly pool

  constructor(
    readonly scope: StorageScope,
    readonly location: string,
    ftsEnabled = true,
    ftsBackend: PostgresFtsBackend = 'tsvector',
  ) {
    this.pool = getPgPool(location)
    this.metadata = new PostgresMetadataStore(this.pool)
    this.vectors = new PgVectorStore(this.pool)
    this.fts = ftsEnabled ? new PostgresFtsStore(this.pool, ftsBackend) : null
    this.graph = new PostgresGraphStore(this.pool)
  }

  async writeFileBlob(args: WriteFileBlobArgs): Promise<void> {
    await ensurePostgresSchema(this.pool)
    const { blobHash, size, path, model, embedding, fileType, content } = args
    const vec = `[${Array.from(embedding).join(',')}]`
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'INSERT INTO blobs (blob_hash, size, indexed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [blobHash, size, Date.now()],
      )
      await client.query(
        `INSERT INTO embeddings (blob_hash, model, dimensions, vector, file_type)
         VALUES ($1, $2, $3, $4::vector, $5) ON CONFLICT (blob_hash, model) DO NOTHING`,
        [blobHash, model, embedding.length, vec, fileType ?? null],
      )
      await client.query(
        'INSERT INTO paths (blob_hash, path) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [blobHash, path],
      )
      if (content !== undefined) {
        await client.query(
          `INSERT INTO blob_fts (blob_hash, content) VALUES ($1, $2)
           ON CONFLICT (blob_hash) DO UPDATE SET content = EXCLUDED.content`,
          [blobHash, content],
        )
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  async writeBlobRecord(args: WriteBlobRecordArgs): Promise<void> {
    await ensurePostgresSchema(this.pool)
    const { blobHash, size, path, content } = args
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'INSERT INTO blobs (blob_hash, size, indexed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [blobHash, size, Date.now()],
      )
      await client.query(
        'INSERT INTO paths (blob_hash, path) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [blobHash, path],
      )
      if (content !== undefined) {
        await client.query(
          `INSERT INTO blob_fts (blob_hash, content) VALUES ($1, $2)
           ON CONFLICT (blob_hash) DO UPDATE SET content = EXCLUDED.content`,
          [blobHash, content],
        )
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}
