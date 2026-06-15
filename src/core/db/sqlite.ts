import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import * as schema from './schema.js'
import { runMigrations } from './migrations/runner.js'

const DB_DIR = '.gitsema'
const DB_PATH = join(DB_DIR, 'index.db')

// ---------------------------------------------------------------------------
// DbSession — wraps a drizzle handle + raw sqlite handle for a single DB file
// ---------------------------------------------------------------------------

export interface DbSession {
  db: ReturnType<typeof drizzle<typeof schema>>
  rawDb: InstanceType<typeof Database>
  dbPath: string
}

// ---------------------------------------------------------------------------
// Schema initialisation and migrations (shared by all DB opens)
// ---------------------------------------------------------------------------

/**
 * Current schema version. Increment this whenever a new migration is added.
 * Migrations are applied in order; each one is idempotent.
 *
 * Version history:
 *   1 — Added file_type column to embeddings (Phase 8)
 *   2 — Added blob_branches table (Phase 15)
 *   3 — Added query_embeddings cache table (Phase 18)
 *   4 — Added symbols + symbol_embeddings tables (Phase 19)
 *   5 — Added blob_clusters + cluster_assignments tables (Phase 21)
 *   6 — Added idx_commits_timestamp index for temporal cluster queries (Phase 22)
 *   7 — Added commit_embeddings table for commit message semantic search (Phase 30)
 *   8 — Added author_name, author_email to commits (Phase 31)
 *   9 — Added module_embeddings table + chunk_id on symbols (Phase 33)
 *  10 — Reworked embedding tables to support multi-model embeddings per blob/chunk/symbol/commit/module
 *  11 — Added quantization columns to embedding tables (Phase 36)
 * 12 — Added missing performance indexes on paths, symbols, chunks, blob_commits and blob_branches (performance fix)
 * 13 — Added embed_config provenance table and indexing_checkpoints table
 * 14 — Added repos table for multi-repo registry (Phase 41)
 * 15 — Added db_path column to repos table (Phase 50)
 * 16 — Added saved_queries table (Phase 53)
 * 17 — Added projections table (Phase 55)
 * 18 — Added last_used_at column to embed_config (multi-model status tracking)
 * 19 — Added repo_tokens table (Phase 75 per-repo access control)
 * 20 — Enforce uniqueness of (blob_hash, path) in paths table (review6 §11.6)
 * 21 — Hash repo tokens at rest: token_hash + token_prefix replace plaintext token (review7 §4.1)
 * 22 — Added kind + params_json columns to embed_config; added settings table (narrator model config)
 * 23 — Added normalized_url, clone_path, last_indexed_at, ephemeral columns to repos table for
 *       persistent server-side repo storage (GITSEMA_DATA_DIR registry)
 * 24 — Added qualified_name, signature, signature_hash, parent_qualified_name columns to
 *       symbols table for path-free stable symbol identity (Phase 105 / knowledge-graph §3.1)
 */
export const CURRENT_SCHEMA_VERSION = 24

/**
 * Applies pending schema migrations and records the resulting version in the
 * `meta` table. Safe to call on both fresh and existing databases.
 */
function applyMigrations(sqlite: InstanceType<typeof Database>): void {
  runMigrations(sqlite)
}


/** The full CREATE TABLE block used for every new database file. */
function initTables(sqlite: InstanceType<typeof Database>): void {
  // Detect whether this is a truly fresh database BEFORE creating any tables.
  // We use this to stamp fresh DBs with CURRENT_SCHEMA_VERSION so that
  // applyMigrations() skips migration steps that drop-and-recreate tables.
  // Without this, those migrations would strip columns that initTables
  // already included, and later migrations adding those columns back would
  // fail with "duplicate column name" errors.
  const isFresh =
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blobs'")
        .get() as undefined | { name: string }
    ) === undefined

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS blobs (
      blob_hash TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      quantized INTEGER DEFAULT 0,
      quant_min REAL,
      quant_scale REAL,
      file_type TEXT,
      PRIMARY KEY (blob_hash, model)
    );

    CREATE TABLE IF NOT EXISTS paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commits (
      commit_hash TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
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
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id INTEGER NOT NULL REFERENCES chunks(id),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      quantized INTEGER DEFAULT 0,
      quant_min REAL,
      quant_scale REAL,
      PRIMARY KEY (chunk_id, model)
    );

    -- FTS5 virtual table for hybrid (BM25 + vector) search (Phase 11)
    CREATE VIRTUAL TABLE IF NOT EXISTS blob_fts USING fts5(
      blob_hash UNINDEXED,
      content,
      tokenize='porter ascii'
    );

    -- Branch → blob associations, populated during commit-mapping (Phase 15)
    CREATE TABLE IF NOT EXISTS blob_branches (
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      branch_name TEXT NOT NULL,
      PRIMARY KEY (blob_hash, branch_name)
    );

    -- Query embedding cache — avoids re-embedding identical queries (Phase 18)
    CREATE TABLE IF NOT EXISTS query_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_text TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      cached_at INTEGER NOT NULL,
      UNIQUE (query_text, model)
    );

    -- Symbol-level registry: named declarations extracted by the function chunker (Phase 19)
    -- qualified_name/signature/signature_hash/parent_qualified_name added in v24 (Phase 105)
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      symbol_name TEXT NOT NULL,
      symbol_kind TEXT NOT NULL,
      language TEXT NOT NULL,
      chunk_id INTEGER,
      qualified_name TEXT,
      signature TEXT,
      signature_hash TEXT,
      parent_qualified_name TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name_sig ON symbols(qualified_name, signature_hash);
    CREATE INDEX IF NOT EXISTS idx_symbols_blob_hash_qualified_name ON symbols(blob_hash, qualified_name);

    -- Enriched embeddings for symbol-level semantic search (Phase 19)
    CREATE TABLE IF NOT EXISTS symbol_embeddings (
      symbol_id INTEGER NOT NULL REFERENCES symbols(id),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      quantized INTEGER DEFAULT 0,
      quant_min REAL,
      quant_scale REAL,
      PRIMARY KEY (symbol_id, model)
    );

    CREATE TABLE IF NOT EXISTS blob_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      centroid BLOB NOT NULL,
      size INTEGER NOT NULL,
      representative_paths TEXT NOT NULL,
      top_keywords TEXT NOT NULL,
      clustered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cluster_assignments (
      blob_hash TEXT PRIMARY KEY REFERENCES blobs(blob_hash),
      cluster_id INTEGER NOT NULL REFERENCES blob_clusters(id)
    );

    -- Commit message embeddings for semantic commit search (Phase 30)
    CREATE TABLE IF NOT EXISTS commit_embeddings (
      commit_hash TEXT NOT NULL REFERENCES commits(commit_hash),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      quantized INTEGER DEFAULT 0,
      quant_min REAL,
      quant_scale REAL,
      PRIMARY KEY (commit_hash, model)
    );

    -- Index on commits.timestamp for fast temporal cluster filtering (Phase 22)
    CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits (timestamp);

    -- Module-level directory centroid embeddings (Phase 33)
    CREATE TABLE IF NOT EXISTS module_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_path TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      blob_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (module_path, model)
    );

    -- Embedding provenance (Phase 35 / v13); last_used_at added in v18; kind + params_json added in v22
    CREATE TABLE IF NOT EXISTS embed_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_hash TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      code_model TEXT,
      dimensions INTEGER NOT NULL,
      chunker TEXT NOT NULL,
      window_size INTEGER,
      overlap INTEGER,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      kind TEXT DEFAULT 'embedding',
      params_json TEXT
    );

    -- Incremental-indexing resume markers (Phase 35 / v13)
    CREATE TABLE IF NOT EXISTS indexing_checkpoints (
      blob_hash TEXT PRIMARY KEY,
      commit_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER NOT NULL
    );

    -- Multi-repo registry (Phase 41 / v14); db_path added in v15;
    -- normalized_url, clone_path, last_indexed_at, ephemeral added in v23
    -- (persistent server-side repo storage)
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      db_path TEXT,
      added_at INTEGER NOT NULL,
      normalized_url TEXT,
      clone_path TEXT,
      last_indexed_at INTEGER,
      ephemeral INTEGER NOT NULL DEFAULT 0
    );

    -- Per-repo access control tokens (review7 §4.1 / v21): token is stored as SHA-256 hash.
    -- token_prefix stores the first 8 chars of the original token for display/revoke lookup.
    CREATE TABLE IF NOT EXISTS repo_tokens (
      token_hash  TEXT PRIMARY KEY,
      token_prefix TEXT NOT NULL,
      repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      label       TEXT,
      created_at  INTEGER NOT NULL
    );

    -- Saved search queries / watch-mode entries (Phase 53 / v16)
    CREATE TABLE IF NOT EXISTS saved_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      query_text TEXT NOT NULL,
      query_embedding BLOB,
      last_run_ts INTEGER,
      webhook_url TEXT,
      created_at INTEGER NOT NULL
    );

    -- Embedding space 2-D projections (Phase 55 / v17)
    CREATE TABLE IF NOT EXISTS projections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      model TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      projected_at INTEGER NOT NULL,
      UNIQUE (blob_hash, model)
    );

    -- Narrator model config and active settings (schema v22)
    -- kind column on embed_config distinguishes 'embedding' from 'narrator' configs
    -- params_json stores narrator-specific params (httpUrl, apiKey, maxTokens, etc.)
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  if (isFresh) {
    // Stamp this brand-new database at the current schema version so that
    // applyMigrations() skips all migration steps.  Without this, migrations
    // that drop-and-recreate tables would strip columns that initTables
    // already included, and later migrations that try to add those columns
    // back would fail with "duplicate column name" errors.
    sqlite.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`)
    sqlite
      .prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)`)
      .run(String(CURRENT_SCHEMA_VERSION))
    // For fresh DBs we can safely create the unique index enforcing (blob_hash, path).
    // For existing DBs this must be performed by the v20 migration after deduplication.
    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_paths_blob_path_unique
        ON paths(blob_hash, path);
    `)
    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_normalized_url
        ON repos(normalized_url);
    `)
  }
}

// ---------------------------------------------------------------------------
// Default database (lazy singleton — opened on first access)
// ---------------------------------------------------------------------------

let _defaultSession: DbSession | undefined

/**
 * Opens the default database lazily on first call and caches the session.
 * All subsequent calls return the same session.
 */
function getDefaultSession(): DbSession {
  if (!_defaultSession) {
    _defaultSession = openDatabaseAt(DB_PATH)
  }
  return _defaultSession
}

/**
 * Test-only: override (or clear) the lazily-created default session.
 * Lets tests that exercise `getActiveSession()`'s default-session fallback
 * (e.g. HTTP routes with no per-request session override) avoid creating a
 * real `.gitsema/index.db` in the current working directory.
 */
export function __setDefaultSessionForTesting(session: DbSession | undefined): void {
  _defaultSession = session
}

/**
 * @deprecated Prefer `getActiveSession().db` in new code.
 *
 * Returns the default Drizzle ORM handle. Triggers lazy initialization of
 * the default database on first access.
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  return getDefaultSession().db
}

// Backward-compatible alias: importing `db` still works but now triggers
// lazy init via the getter instead of eagerly at module load time.
// NOTE: `db` is a getter on the module namespace — not a plain value.
// Callers that destructure `import { db }` capture the getter result at
// import time; callers that use `db` through the module object get lazy
// evaluation. Either way, the first access triggers `getDefaultSession()`.

let _dbProxy: ReturnType<typeof drizzle<typeof schema>> | undefined
/** @deprecated Use `getDb()` or `getActiveSession().db` in new code. */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    if (!_dbProxy) _dbProxy = getDefaultSession().db
    return Reflect.get(_dbProxy, prop, receiver)
  },
})

export { DB_PATH }

/** @deprecated Prefer getActiveSession().rawDb in new code. */
export function getRawDb(): InstanceType<typeof Database> {
  return getDefaultSession().rawDb
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage session context (Phase 17)
// ---------------------------------------------------------------------------

/**
 * Holds the active DbSession for the current async call chain.
 * When not set, getActiveSession() returns the default session.
 */
const _sessionStorage = new AsyncLocalStorage<DbSession>()

/**
 * Returns the active DbSession for the current async context.
 * Falls back to the default (module-level) session when no override is active.
 */
export function getActiveSession(): DbSession {
  return _sessionStorage.getStore() ?? getDefaultSession()
}

/**
 * Runs `fn` with `session` as the active DbSession for all async descendants.
 * Safe for concurrent jobs — each call chain gets its own isolated context.
 */
export function withDbSession<T>(session: DbSession, fn: () => Promise<T>): Promise<T> {
  return _sessionStorage.run(session, fn)
}

// ---------------------------------------------------------------------------
// Per-label database factory (Phase 17 — per-repo DB sessions)
// ---------------------------------------------------------------------------

/** Cache of open labeled DB sessions. Keys are validated label strings. */
const _labeledDbs = new Map<string, DbSession>()

/**
 * Opens (or creates) a database at the given absolute path.
 * Applies the same schema and migrations as the default database.
 */
export function openDatabaseAt(dbPath: string): DbSession {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  initTables(sqlite)
  applyMigrations(sqlite)
  const drizzleDb = drizzle(sqlite, { schema })
  return { db: drizzleDb, rawDb: sqlite, dbPath }
}

/**
 * Returns a labeled DbSession, creating it on first use.
 * The DB file is stored at `.gitsema/<label>.db` relative to cwd.
 *
 * @param label - alphanumeric label (validated by the caller before passing here)
 */
export function getOrOpenLabeledDb(label: string): DbSession {
  const existing = _labeledDbs.get(label)
  if (existing) return existing
  const dbPath = join(DB_DIR, `${label}.db`)
  const session = openDatabaseAt(dbPath)
  _labeledDbs.set(label, session)
  return session
}

// ---------------------------------------------------------------------------
// Per-path database cache (persistent repo storage — server registry)
// ---------------------------------------------------------------------------

/** Cache of open DB sessions keyed by absolute file path. */
const _pathSessions = new Map<string, DbSession>()

/**
 * Returns a cached DbSession for the given absolute path, opening it on
 * first use. Unlike `openDatabaseAt`, repeated calls with the same path
 * return the same session (and the same underlying sqlite connection).
 */
export function getOrOpenSessionAtPath(dbPath: string): DbSession {
  const existing = _pathSessions.get(dbPath)
  if (existing) return existing
  const session = openDatabaseAt(dbPath)
  _pathSessions.set(dbPath, session)
  return session
}

/**
 * Closes and evicts a cached path-keyed DB session (if open), releasing its
 * underlying sqlite file handle. Used in tests on Windows, where an open
 * WAL-mode database file cannot be deleted while held open.
 */
export function closeSessionAtPath(dbPath: string): void {
  const existing = _pathSessions.get(dbPath)
  if (!existing) return
  existing.rawDb.close()
  _pathSessions.delete(dbPath)
}

/**
 * Closes and evicts all cached path-keyed DB sessions, releasing their
 * underlying sqlite file handles. Used in tests on Windows, where an open
 * WAL-mode database file cannot be deleted while held open.
 */
export function closeAllPathSessions(): void {
  for (const session of _pathSessions.values()) {
    session.rawDb.close()
  }
  _pathSessions.clear()
}
