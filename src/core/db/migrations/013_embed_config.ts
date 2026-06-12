import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 13,
  description: 'Add embed_config and indexing_checkpoints tables',
  up(sqlite: InstanceType<typeof Database>) {
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
  },
}
