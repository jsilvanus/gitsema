import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 18,
  description: 'Add last_used_at column to embed_config',
  up(sqlite: InstanceType<typeof Database>) {
    const embedConfigCols = sqlite.prepare('PRAGMA table_info(embed_config)').all() as Array<{ name: string }>
    if (!embedConfigCols.some((c) => c.name === 'last_used_at')) {
      sqlite.exec(`ALTER TABLE embed_config ADD COLUMN last_used_at INTEGER`)
    }
  },
}
