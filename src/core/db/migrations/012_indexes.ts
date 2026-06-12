import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 12,
  description: 'Add missing performance indexes',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_paths_blob_hash ON paths(blob_hash)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_paths_path ON paths(path)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_symbols_blob_hash ON symbols(blob_hash)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_blob_hash ON chunks(blob_hash)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_blob_commits_blob_hash ON blob_commits(blob_hash)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_blob_branches_branch_name ON blob_branches(branch_name)`)
  },
}
