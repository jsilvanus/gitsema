import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 1,
  description: 'Add file_type column to embeddings',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`ALTER TABLE embeddings ADD COLUMN file_type TEXT`)
  },
}
