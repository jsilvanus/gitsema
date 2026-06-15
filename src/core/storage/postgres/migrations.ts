/**
 * Postgres schema for the storage seam (Phase 102).
 *
 * Mirrors the subset of `src/core/db/schema.ts` (SQLite/Drizzle) needed by
 * `MetadataStore`, `VectorStore`, and `FtsStore`. Kept as plain SQL (not
 * Drizzle) since this is a separate migration track from `sqlite.ts`'s
 * versioned migrations (see docs/storage-backends-plan.md §8).
 *
 * Embedding columns use the unconstrained `vector` type (pgvector ≥0.5) so
 * blobs embedded with different models/dimensions can share one table.
 * An unconstrained `vector` column cannot carry an HNSW index (HNSW requires
 * a fixed dimension); `PgVectorStore` therefore runs exact `<=>` kNN scans.
 * Per-model HNSW indexes are a documented follow-up (see PLAN.md Phase 102
 * deviations).
 */

import type { Pool } from 'pg'

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS blobs (
  blob_hash TEXT PRIMARY KEY,
  size BIGINT NOT NULL,
  indexed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS paths (
  id BIGSERIAL PRIMARY KEY,
  blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
  path TEXT NOT NULL,
  UNIQUE (blob_hash, path)
);

CREATE TABLE IF NOT EXISTS commits (
  commit_hash TEXT PRIMARY KEY,
  "timestamp" BIGINT NOT NULL,
  message TEXT NOT NULL,
  author_name TEXT,
  author_email TEXT
);

CREATE TABLE IF NOT EXISTS blob_commits (
  blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
  commit_hash TEXT NOT NULL REFERENCES commits(commit_hash),
  PRIMARY KEY (blob_hash, commit_hash)
);

CREATE TABLE IF NOT EXISTS indexed_commits (
  commit_hash TEXT PRIMARY KEY,
  indexed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS blob_branches (
  blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
  branch_name TEXT NOT NULL,
  PRIMARY KEY (blob_hash, branch_name)
);

CREATE TABLE IF NOT EXISTS embeddings (
  blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
  model TEXT NOT NULL,
  dimensions INT NOT NULL,
  vector vector NOT NULL,
  file_type TEXT,
  PRIMARY KEY (blob_hash, model)
);

CREATE TABLE IF NOT EXISTS chunks (
  id BIGSERIAL PRIMARY KEY,
  blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
  start_line INT NOT NULL,
  end_line INT NOT NULL,
  UNIQUE (blob_hash, start_line, end_line)
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id BIGINT NOT NULL REFERENCES chunks(id),
  model TEXT NOT NULL,
  dimensions INT NOT NULL,
  vector vector NOT NULL,
  PRIMARY KEY (chunk_id, model)
);

CREATE TABLE IF NOT EXISTS symbols (
  id BIGSERIAL PRIMARY KEY,
  blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
  start_line INT NOT NULL,
  end_line INT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_kind TEXT NOT NULL,
  language TEXT NOT NULL,
  chunk_id BIGINT,
  -- qualified_name/signature/signature_hash/parent_qualified_name added in v24 (Phase 105)
  qualified_name TEXT,
  signature TEXT,
  signature_hash TEXT,
  parent_qualified_name TEXT,
  UNIQUE (blob_hash, start_line, end_line, symbol_name)
);

-- Idempotent column additions for symbols tables created before Phase 105.
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS qualified_name TEXT;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS signature_hash TEXT;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS parent_qualified_name TEXT;

CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name_sig ON symbols(qualified_name, signature_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_blob_hash_qualified_name ON symbols(blob_hash, qualified_name);

CREATE TABLE IF NOT EXISTS symbol_embeddings (
  symbol_id BIGINT NOT NULL REFERENCES symbols(id),
  model TEXT NOT NULL,
  dimensions INT NOT NULL,
  vector vector NOT NULL,
  PRIMARY KEY (symbol_id, model)
);

CREATE TABLE IF NOT EXISTS module_embeddings (
  id BIGSERIAL PRIMARY KEY,
  module_path TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INT NOT NULL,
  vector vector NOT NULL,
  blob_count INT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (module_path, model)
);

CREATE TABLE IF NOT EXISTS commit_embeddings (
  commit_hash TEXT NOT NULL REFERENCES commits(commit_hash),
  model TEXT NOT NULL,
  dimensions INT NOT NULL,
  vector vector NOT NULL,
  PRIMARY KEY (commit_hash, model)
);

CREATE TABLE IF NOT EXISTS blob_fts (
  blob_hash TEXT PRIMARY KEY REFERENCES blobs(blob_hash),
  content TEXT NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS idx_blob_fts_tsv ON blob_fts USING GIN (tsv);
`

const migrated = new WeakSet<Pool>()

/**
 * Ensures the Postgres schema exists on `pool`'s database. Idempotent and
 * memoized per pool — safe to call before every operation.
 */
export async function ensurePostgresSchema(pool: Pool): Promise<void> {
  if (migrated.has(pool)) return
  // This is the first query against the pool, so a bad connection string /
  // unreachable server surfaces here. Wrap the raw pg error in an actionable
  // message pointing at the config key, rather than leaking an opaque
  // ECONNREFUSED / auth failure to the user (review9 §7.2).
  try {
    await pool.query(SCHEMA_SQL)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Cannot connect to the Postgres storage backend ` +
      `(storage.metadata.url / GITSEMA_STORAGE_METADATA_URL): ${detail}`,
    )
  }
  migrated.add(pool)
}
