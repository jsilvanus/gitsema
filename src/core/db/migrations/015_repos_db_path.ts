import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 15,
  description: 'Add db_path column to repos table',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`ALTER TABLE repos ADD COLUMN db_path TEXT;`)
  },
}
