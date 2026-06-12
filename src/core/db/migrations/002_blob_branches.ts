import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 2,
  description: 'Add blob_branches table',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS blob_branches (
        blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
        branch_name TEXT NOT NULL,
        PRIMARY KEY (blob_hash, branch_name)
      )
    `)
  },
}
