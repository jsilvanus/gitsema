import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 4,
  description: 'Add symbols and symbol_embeddings tables',
  up(sqlite: InstanceType<typeof Database>) {
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
  },
}
