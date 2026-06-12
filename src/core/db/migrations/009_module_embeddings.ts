import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 9,
  description: 'Add module_embeddings table and chunk_id on symbols',
  up(sqlite: InstanceType<typeof Database>) {
    const symbolCols = sqlite.prepare(`PRAGMA table_info(symbols)`).all() as Array<{ name: string }>
    if (!symbolCols.some((c) => c.name === 'chunk_id')) {
      sqlite.exec(`ALTER TABLE symbols ADD COLUMN chunk_id INTEGER`)
    }
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS module_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_path TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        blob_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  },
}
