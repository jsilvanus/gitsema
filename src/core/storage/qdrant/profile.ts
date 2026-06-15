/**
 * Qdrant-backed `StorageProfile` (Phase 103).
 *
 * `location` is the Qdrant URL (`storage.vectors.url`). Metadata and FTS
 * duties are delegated to a Postgres companion (`storage.metadata.url`),
 * reusing `PostgresMetadataStore`/`PostgresFtsStore` from Phase 102 — Qdrant
 * holds vectors + a small payload only (see docs/storage-backends-plan.md §6.5).
 *
 * Unlike `PostgresStorageProfile`, `writeFileBlob`/`writeBlobRecord` cannot be
 * a single cross-store transaction: the Postgres companion write (blob, path,
 * FTS content) commits in one transaction, then the embedding is upserted into
 * Qdrant. If the Qdrant upsert fails, the companion row remains — a re-index
 * retries the upsert (idempotent via `ON CONFLICT`/deterministic point ids),
 * matching the "idempotent re-index self-heals" consistency model in
 * docs/storage-backends-plan.md §8.
 */

import { getPgPool } from '../postgres/connection.js'
import { ensurePostgresSchema } from '../postgres/migrations.js'
import { PostgresMetadataStore } from '../postgres/metadataStore.js'
import { PostgresFtsStore, type PostgresFtsBackend } from '../postgres/ftsStore.js'
import { getQdrantClient } from './connection.js'
import { QdrantVectorStore } from './vectorStore.js'
import { UnsupportedGraphStore } from '../unsupportedGraphStore.js'
import type { FtsStore, GraphStore, MetadataStore, StorageProfile, StorageScope, VectorStore, WriteBlobRecordArgs, WriteFileBlobArgs } from '../types.js'

export class QdrantStorageProfile implements StorageProfile {
  readonly backend = 'qdrant' as const
  readonly metadata: MetadataStore
  readonly vectors: VectorStore
  readonly fts: FtsStore | null
  readonly graph: GraphStore = new UnsupportedGraphStore()
  private readonly pool

  constructor(
    readonly scope: StorageScope,
    readonly location: string,
    metadataUrl: string,
    apiKey?: string,
    ftsEnabled = true,
    ftsBackend: PostgresFtsBackend = 'tsvector',
  ) {
    this.pool = getPgPool(metadataUrl)
    this.metadata = new PostgresMetadataStore(this.pool)
    this.vectors = new QdrantVectorStore(getQdrantClient(location, apiKey), this.pool)
    this.fts = ftsEnabled ? new PostgresFtsStore(this.pool, ftsBackend) : null
  }

  async writeFileBlob(args: WriteFileBlobArgs): Promise<void> {
    await ensurePostgresSchema(this.pool)
    const { blobHash, size, path, model, embedding, content, quantize } = args
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
    await this.vectors.upsert('file', [{ id: blobHash, model, dimensions: embedding.length, embedding, quantize }])
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
