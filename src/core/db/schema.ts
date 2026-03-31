import { sqliteTable, text, integer, blob, primaryKey } from 'drizzle-orm/sqlite-core'

/**
 * Sub-file fragments produced by a chunker (function / fixed strategy).
 * One row per chunk; the blob_hash FK links back to the source blob.
 * Line numbers are 1-indexed and inclusive.
 */
export const chunks = sqliteTable('chunks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  blobHash: text('blob_hash').notNull().references(() => blobs.blobHash),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
})

/**
 * Vector embedding for a chunk.  Keyed by chunk_id; one embedding per chunk.
 */
export const chunkEmbeddings = sqliteTable('chunk_embeddings', {
  chunkId: integer('chunk_id').primaryKey().references(() => chunks.id),
  model: text('model').notNull(),
  dimensions: integer('dimensions').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
})

export const blobs = sqliteTable('blobs', {
  blobHash: text('blob_hash').primaryKey(),
  size: integer('size').notNull(),
  indexedAt: integer('indexed_at').notNull(),
})

export const embeddings = sqliteTable('embeddings', {
  blobHash: text('blob_hash').primaryKey().references(() => blobs.blobHash),
  model: text('model').notNull(),
  dimensions: integer('dimensions').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  /** File category used when selecting the embedding model: 'code' | 'text' | 'other'. */
  fileType: text('file_type'),
})

export const paths = sqliteTable('paths', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  blobHash: text('blob_hash').notNull().references(() => blobs.blobHash),
  path: text('path').notNull(),
})

export const commits = sqliteTable('commits', {
  commitHash: text('commit_hash').primaryKey(),
  timestamp: integer('timestamp').notNull(),
  message: text('message').notNull(),
})

export const blobCommits = sqliteTable('blob_commits', {
  blobHash: text('blob_hash').notNull().references(() => blobs.blobHash),
  commitHash: text('commit_hash').notNull().references(() => commits.commitHash),
}, (table) => ({
  pk: primaryKey({ columns: [table.blobHash, table.commitHash] }),
}))

/**
 * Tracks which commits have been fully processed by the indexer.
 * Used by incremental indexing to default --since to the last indexed point.
 */
export const indexedCommits = sqliteTable('indexed_commits', {
  commitHash: text('commit_hash').primaryKey(),
  indexedAt: integer('indexed_at').notNull(),
})
