import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as schema from './schema.js'

const DB_DIR = '.gitsema'
const DB_PATH = join(DB_DIR, 'index.db')

function openDatabase(): ReturnType<typeof drizzle> {
  mkdirSync(DB_DIR, { recursive: true })
  const sqlite = new Database(DB_PATH)
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
  `)

  // Migrate existing databases: add file_type column if it doesn't exist yet
  const embeddingsColumns = sqlite.prepare(`PRAGMA table_info(embeddings)`).all() as Array<{ name: string }>
  if (!embeddingsColumns.some((c) => c.name === 'file_type')) {
    sqlite.exec(`ALTER TABLE embeddings ADD COLUMN file_type TEXT`)
  }

  return db
}

export const db = openDatabase()
export { DB_PATH }
