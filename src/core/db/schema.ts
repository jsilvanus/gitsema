import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core'

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
})

export const paths = sqliteTable('paths', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  blobHash: text('blob_hash').notNull().references(() => blobs.blobHash),
  path: text('path').notNull(),
})
