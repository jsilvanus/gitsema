import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 17,
  description: 'Add projections table',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS projections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
        model TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        projected_at INTEGER NOT NULL,
        UNIQUE (blob_hash, model)
      );
    `)
  },
}
