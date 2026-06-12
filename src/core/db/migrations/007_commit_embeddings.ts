import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 7,
  description: 'Add commit_embeddings table',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS commit_embeddings (
        commit_hash TEXT PRIMARY KEY REFERENCES commits(commit_hash),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL
      )
    `)
  },
}
