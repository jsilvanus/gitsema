import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import * as schema from './schema.js'

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
 */
export const CURRENT_SCHEMA_VERSION = 13

/**
 * Applies pending schema migrations and records the resulting version in the
 * `meta` table. Safe to call on both fresh and existing databases.
 */
function applyMigrations(sqlite: InstanceType<typeof Database>): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`)

  const row = sqlite.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined

  let version: number
  if (row === undefined) {
    // meta table just created — determine starting version by inspecting the
    // live schema so we don't re-apply migrations that already ran.
    const cols = sqlite.prepare(`PRAGMA table_info(embeddings)`).all() as Array<{ name: string }>
    version = cols.some((c) => c.name === 'file_type') ? 1 : 0
    sqlite.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(version))
  } else {
    version = parseInt(row.value, 10)
  }

  // v0 → v1: add file_type column to embeddings
  if (version < 1) {
    sqlite.exec(`ALTER TABLE embeddings ADD COLUMN file_type TEXT`)
    version = 1
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('1')
  }

  // v1 → v2: add blob_branches table
  if (version < 2) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS blob_branches (
        blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
        branch_name TEXT NOT NULL,
        PRIMARY KEY (blob_hash, branch_name)
      )
    `)
    version = 2
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('2')
  }

  // v2 → v3: add query_embeddings cache table (Phase 18)
  if (version < 3) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS query_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_text TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        cached_at INTEGER NOT NULL,
        UNIQUE (query_text, model)
      )
    `)
    version = 3
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('3')
  }

  // v3 → v4: add symbols + symbol_embeddings tables (Phase 19)
  if (version < 4) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        symbol_name TEXT NOT NULL,
        symbol_kind TEXT NOT NULL,
        language TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS symbol_embeddings (
        symbol_id INTEGER PRIMARY KEY REFERENCES symbols(id),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL
      );
    `)
    version = 4
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('4')
  }

  // v4 → v5: add blob_clusters + cluster_assignments tables (Phase 21)
  if (version < 5) {
    sqlite.exec(`
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
    `)
    version = 5
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('5')
  }

  // v5 → v6: add index on commits.timestamp for fast temporal cluster queries (Phase 22)
  if (version < 6) {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits (timestamp)`)
    version = 6
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('6')
  }

  // v6 → v7: add commit_embeddings table for commit message semantic search (Phase 30)
  if (version < 7) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS commit_embeddings (
        commit_hash TEXT PRIMARY KEY REFERENCES commits(commit_hash),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL
      )
    `)
    version = 7
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('7')
  }

  // v7 → v8: add author_name and author_email columns to commits (Phase 31)
  if (version < 8) {
    // Guard against fresh DBs where initTables() already added these columns
    const commitCols = sqlite.prepare('PRAGMA table_info(commits)').all() as Array<{ name: string }>
    if (!commitCols.some((c) => c.name === 'author_name')) {
      sqlite.exec(`ALTER TABLE commits ADD COLUMN author_name TEXT`)
    }
    if (!commitCols.some((c) => c.name === 'author_email')) {
      sqlite.exec(`ALTER TABLE commits ADD COLUMN author_email TEXT`)
    }
    version = 8
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('8')
  }

  // v8 → v9: add module_embeddings table and chunk_id on symbols (Phase 33)
  if (version < 9) {
    // Guard the ALTER TABLE: column may already exist when the DB was created
    // from scratch with the updated initTables (which already includes chunk_id).
    const symbolCols = sqlite.prepare(`PRAGMA table_info(symbols)`).all() as Array<{ name: string }>
    if (!symbolCols.some((c) => c.name === 'chunk_id')) {
      sqlite.exec(`ALTER TABLE symbols ADD COLUMN chunk_id INTEGER`)
    }

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS module_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_path TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        blob_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    version = 9
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('9')
  }

  // v9 → v10: rebuild embedding tables with composite (hash, model) PKs
  if (version < 10) {
    sqlite.pragma('foreign_keys = OFF')
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS embeddings_v10 (
        blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        file_type TEXT,
        PRIMARY KEY (blob_hash, model)
      );
      INSERT OR IGNORE INTO embeddings_v10 SELECT blob_hash, model, dimensions, vector, file_type FROM embeddings;
      DROP TABLE embeddings;
      ALTER TABLE embeddings_v10 RENAME TO embeddings;

      CREATE TABLE IF NOT EXISTS chunk_embeddings_v10 (
        chunk_id INTEGER NOT NULL REFERENCES chunks(id),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (chunk_id, model)
      );
      INSERT OR IGNORE INTO chunk_embeddings_v10 SELECT chunk_id, model, dimensions, vector FROM chunk_embeddings;
      DROP TABLE chunk_embeddings;
      ALTER TABLE chunk_embeddings_v10 RENAME TO chunk_embeddings;

      CREATE TABLE IF NOT EXISTS symbol_embeddings_v10 (
        symbol_id INTEGER NOT NULL REFERENCES symbols(id),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (symbol_id, model)
      );
      INSERT OR IGNORE INTO symbol_embeddings_v10 SELECT symbol_id, model, dimensions, vector FROM symbol_embeddings;
      DROP TABLE symbol_embeddings;
      ALTER TABLE symbol_embeddings_v10 RENAME TO symbol_embeddings;

      CREATE TABLE IF NOT EXISTS commit_embeddings_v10 (
        commit_hash TEXT NOT NULL REFERENCES commits(commit_hash),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (commit_hash, model)
      );
      INSERT OR IGNORE INTO commit_embeddings_v10 SELECT commit_hash, model, dimensions, vector FROM commit_embeddings;
      DROP TABLE commit_embeddings;
      ALTER TABLE commit_embeddings_v10 RENAME TO commit_embeddings;

      CREATE TABLE IF NOT EXISTS module_embeddings_v10 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_path TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        blob_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (module_path, model)
      );
      INSERT OR IGNORE INTO module_embeddings_v10 SELECT id, module_path, model, dimensions, vector, blob_count, updated_at FROM module_embeddings;
      DROP TABLE module_embeddings;
      ALTER TABLE module_embeddings_v10 RENAME TO module_embeddings;
    `)
    sqlite.pragma('foreign_keys = ON')
    version = 10
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('10')
  }

  // v10 → v11: add quantization columns to embedding tables (Phase 36)
  if (version < 11) {
    // Use PRAGMA table_info guards to ensure idempotency on fresh DBs
    const embCols = sqlite.prepare('PRAGMA table_info(embeddings)').all() as Array<{ name: string }>
    if (!embCols.some((c) => c.name === 'quantized')) {
      sqlite.exec(`ALTER TABLE embeddings ADD COLUMN quantized INTEGER DEFAULT 0`)
      sqlite.exec(`ALTER TABLE embeddings ADD COLUMN quant_min REAL`)
      sqlite.exec(`ALTER TABLE embeddings ADD COLUMN quant_scale REAL`)
    }

    const chunkCols = sqlite.prepare('PRAGMA table_info(chunk_embeddings)').all() as Array<{ name: string }>
    if (!chunkCols.some((c) => c.name === 'quantized')) {
      sqlite.exec(`ALTER TABLE chunk_embeddings ADD COLUMN quantized INTEGER DEFAULT 0`)
      sqlite.exec(`ALTER TABLE chunk_embeddings ADD COLUMN quant_min REAL`)
      sqlite.exec(`ALTER TABLE chunk_embeddings ADD COLUMN quant_scale REAL`)
    }

    const symCols = sqlite.prepare('PRAGMA table_info(symbol_embeddings)').all() as Array<{ name: string }>
    if (!symCols.some((c) => c.name === 'quantized')) {
      sqlite.exec(`ALTER TABLE symbol_embeddings ADD COLUMN quantized INTEGER DEFAULT 0`)
      sqlite.exec(`ALTER TABLE symbol_embeddings ADD COLUMN quant_min REAL`)
      sqlite.exec(`ALTER TABLE symbol_embeddings ADD COLUMN quant_scale REAL`)
    }

    const commitEmbCols = sqlite.prepare('PRAGMA table_info(commit_embeddings)').all() as Array<{ name: string }>
    if (!commitEmbCols.some((c) => c.name === 'quantized')) {
      sqlite.exec(`ALTER TABLE commit_embeddings ADD COLUMN quantized INTEGER DEFAULT 0`)
      sqlite.exec(`ALTER TABLE commit_embeddings ADD COLUMN quant_min REAL`)
      sqlite.exec(`ALTER TABLE commit_embeddings ADD COLUMN quant_scale REAL`)
    }

    version = 11
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('11')
  }

  // v11 → v12: add missing performance indexes
  if (version < 12) {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_paths_blob_hash ON paths(blob_hash)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_paths_path ON paths(path)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_blob_hash ON symbols(blob_hash)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_blob_hash ON chunks(blob_hash)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_blob_commits_blob_hash ON blob_commits(blob_hash)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_blob_branches_branch_name ON blob_branches(branch_name)`)
    version = 12
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('12')
  }

  // v12 → v13: add embed_config provenance table and indexing_checkpoints table
  if (version < 13) {
    sqlite.exec(`
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
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexing_checkpoints (
        blob_hash TEXT PRIMARY KEY,
        commit_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER NOT NULL
      );
    `)
    version = 13
    sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('13')
  }
}


/** The full CREATE TABLE block used for every new database file. */
function initTables(sqlite: InstanceType<typeof Database>): void {
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
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      symbol_name TEXT NOT NULL,
      symbol_kind TEXT NOT NULL,
      language TEXT NOT NULL,
      chunk_id INTEGER
    );

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
  `)
}

// ---------------------------------------------------------------------------
// Default database (module-level singleton — backward compatible)
// ---------------------------------------------------------------------------

/** Raw better-sqlite3 handle for the default DB. Used by legacy callers via getRawDb(). */
let rawSqlite: InstanceType<typeof Database>

/** @deprecated Prefer getActiveSession().rawDb in new code. */
export function getRawDb(): InstanceType<typeof Database> {
  return rawSqlite
}

let _defaultSession: DbSession

function openDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  mkdirSync(DB_DIR, { recursive: true })
  const sqlite = new Database(DB_PATH)
  rawSqlite = sqlite
  sqlite.pragma('journal_mode = WAL')

  initTables(sqlite)
  applyMigrations(sqlite)

  const drizzleDb = drizzle(sqlite, { schema })
  _defaultSession = { db: drizzleDb, rawDb: sqlite, dbPath: DB_PATH }
  return drizzleDb
}

export const db = openDatabase()
export { DB_PATH }

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
  return _sessionStorage.getStore() ?? _defaultSession
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
