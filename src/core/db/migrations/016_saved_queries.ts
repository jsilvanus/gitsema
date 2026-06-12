import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 16,
  description: 'Add saved_queries table',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS saved_queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        query_text TEXT NOT NULL,
        query_embedding BLOB,
        last_run_ts INTEGER,
        webhook_url TEXT,
        created_at INTEGER NOT NULL
      );
    `)
  },
}
