import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 6,
  description: 'Add commits timestamp index',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits (timestamp)`)
  },
}
