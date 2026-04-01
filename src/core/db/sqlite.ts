import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as schema from './schema.js'

const DB_DIR = '.gitsema'
const DB_PATH = join(DB_DIR, 'index.db')

/** Raw better-sqlite3 handle, used by modules that need direct SQL access (e.g. FTS5). */
let rawSqlite: InstanceType<typeof Database>

export function getRawDb(): InstanceType<typeof Database> {
  return rawSqlite
}

/**
 * Current schema version. Increment this whenever a new migration is added.
 * Migrations are applied in order; each one is idempotent.
 *
 * Version history:
 *   1 — Added file_type column to embeddings (Phase 8)
 */
const CURRENT_SCHEMA_VERSION = 1

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

  // Future migrations go here:
  // if (version < 2) { sqlite.exec(`...`); version = 2; sqlite.prepare(...).run('2') }
}

function openDatabase(): ReturnType<typeof drizzle> {
  mkdirSync(DB_DIR, { recursive: true })
  const sqlite = new Database(DB_PATH)
  rawSqlite = sqlite
  sqlite.pragma('journal_mode = WAL')

  const db = drizzle(sqlite, { schema })

  // Create tables if they don't exist
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
  `)

  applyMigrations(sqlite)

  return db
}

export const db = openDatabase()
export { DB_PATH }
