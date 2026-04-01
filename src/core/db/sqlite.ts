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
 */
const CURRENT_SCHEMA_VERSION = 2

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

  // Future migrations go here:
  // if (version < 3) { sqlite.exec(`...`); version = 3; sqlite.prepare(...).run('3') }
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
      blob_hash TEXT PRIMARY KEY REFERENCES blobs(blob_hash),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      file_type TEXT
    );

    CREATE TABLE IF NOT EXISTS paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
      path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commits (
      commit_hash TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      message TEXT NOT NULL
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
      chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL
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
