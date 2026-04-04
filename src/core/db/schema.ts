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

/**
 * Maps blob hashes to the branch(es) they appear on.
 * Populated during commit-mapping phase; supports --branch filter on search.
 */
export const blobBranches = sqliteTable('blob_branches', {
  blobHash: text('blob_hash').notNull().references(() => blobs.blobHash),
  branchName: text('branch_name').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.blobHash, table.branchName] }),
}))

/**
 * Cache for query string → embedding vector lookups (Phase 18).
 * Keyed by (query_text, model) so different embedding models have separate entries.
 * Entries expire after a TTL; size is capped by the prune helper.
 */
export const queryEmbeddings = sqliteTable('query_embeddings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  queryText: text('query_text').notNull(),
  model: text('model').notNull(),
  dimensions: integer('dimensions').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  cachedAt: integer('cached_at').notNull(),
})

/**
 * Symbol-level registry (Phase 19).
 *
 * One row per named declaration (function, class, method, impl block, etc.)
 * extracted by the `function` chunker from a blob.  The `symbol_name` and
 * `symbol_kind` columns store the extracted identifier and its kind
 * (e.g. "validateToken" / "function", "Auth" / "class", "Repository" / "impl").
 *
 * Unlike `chunks`, which stores only line boundaries, `symbols` records the
 * rich metadata needed to build enriched embeddings and to enable symbol-level
 * semantic search.
 */
export const symbols = sqliteTable('symbols', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  blobHash: text('blob_hash').notNull().references(() => blobs.blobHash),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  /** Extracted identifier, e.g. "validateToken", "Auth", "Repository". */
  symbolName: text('symbol_name').notNull(),
  /**
   * Kind of the symbol: one of 'function' | 'class' | 'method' | 'impl' |
   * 'struct' | 'enum' | 'trait' | 'other'.
   */
  symbolKind: text('symbol_kind').notNull(),
  /**
   * Detected language for this symbol (e.g. 'typescript', 'python', 'go', 'rust').
   * Stored so callers can format symbol-level search results appropriately.
   */
  language: text('language').notNull(),
  // Optional chunk_id linking this symbol to its source chunk (nullable)
  chunkId: integer('chunk_id'),
})

/**
 * Embedding for a symbol.  Keyed by symbol_id; one embedding per symbol.
 *
 * The embedded text is an **enriched** representation that combines:
 *   - the file path (from the `paths` table)
 *   - the symbol name and kind
 *   - the raw source code of the symbol's line range
 *
 * Example enriched text:
 *   // file: src/auth/jwt.ts  lines 10-25
 *   // function: validateToken
 *   export async function validateToken(token: string): Promise<boolean> { ... }
 *
 * This richer context improves recall for natural-language queries against
 * symbols compared with embedding the bare code snippet alone.
 */
export const symbolEmbeddings = sqliteTable('symbol_embeddings', {
  symbolId: integer('symbol_id').primaryKey().references(() => symbols.id),
  model: text('model').notNull(),
  dimensions: integer('dimensions').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
})

/**
 * One row per clustering run's cluster (Phase 21).
 * Each cluster has a generated label, its centroid vector, representative paths,
 * and top keywords extracted from FTS5 content.
 */
export const blobClusters = sqliteTable('blob_clusters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Auto-generated label derived from the most representative file path */
  label: text('label').notNull(),
  /** Serialised Float32 centroid vector (same format as embeddings.vector) */
  centroid: blob('centroid', { mode: 'buffer' }).notNull(),
  /** Number of blobs assigned to this cluster */
  size: integer('size').notNull(),
  /** JSON-encoded array of the top representative file paths for this cluster */
  representativePaths: text('representative_paths').notNull(),
  /** JSON-encoded array of the top keyword strings extracted from FTS5 content */
  topKeywords: text('top_keywords').notNull(),
  /** Unix timestamp (seconds) of when this clustering run completed */
  clusteredAt: integer('clustered_at').notNull(),
})

/**
 * Many-to-one assignment of blobs to clusters (Phase 21).
 * One row per blob; replaced atomically on each clustering run.
 */
export const clusterAssignments = sqliteTable('cluster_assignments', {
  blobHash: text('blob_hash').primaryKey().references(() => blobs.blobHash),
  clusterId: integer('cluster_id').notNull().references(() => blobClusters.id),
})

// ---------------------------------------------------------------------------
// Module-level embeddings (Phase 33)
// ---------------------------------------------------------------------------
export const moduleEmbeddings = sqliteTable('module_embeddings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  modulePath: text('module_path').notNull().unique(),
  model: text('model').notNull(),
  dimensions: integer('dimensions').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  blobCount: integer('blob_count').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
