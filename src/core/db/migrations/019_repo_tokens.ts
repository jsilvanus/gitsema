import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 19,
  description: 'Add repo_tokens table',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS repo_tokens (
        token TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        label TEXT,
        created_at INTEGER NOT NULL
      )
    `)
  },
}
