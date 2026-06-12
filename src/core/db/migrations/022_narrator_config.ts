import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 22,
  description: 'Add kind + params_json columns to embed_config; add settings table (narrator model config)',
  up(sqlite: InstanceType<typeof Database>) {
    const embedConfigCols = sqlite.prepare('PRAGMA table_info(embed_config)').all() as Array<{ name: string }>
    if (!embedConfigCols.some((c) => c.name === 'kind')) {
      sqlite.exec(`ALTER TABLE embed_config ADD COLUMN kind TEXT DEFAULT 'embedding'`)
    }
    if (!embedConfigCols.some((c) => c.name === 'params_json')) {
      sqlite.exec(`ALTER TABLE embed_config ADD COLUMN params_json TEXT`)
    }
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  },
}
