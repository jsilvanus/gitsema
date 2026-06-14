import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 23,
  description: 'Add normalized_url, clone_path, last_indexed_at, ephemeral columns to repos table for persistent server-side repo storage',
  up(sqlite: InstanceType<typeof Database>) {
    const cols = sqlite.prepare('PRAGMA table_info(repos)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'normalized_url')) {
      sqlite.exec(`ALTER TABLE repos ADD COLUMN normalized_url TEXT;`)
    }
    if (!cols.some((c) => c.name === 'clone_path')) {
      sqlite.exec(`ALTER TABLE repos ADD COLUMN clone_path TEXT;`)
    }
    if (!cols.some((c) => c.name === 'last_indexed_at')) {
      sqlite.exec(`ALTER TABLE repos ADD COLUMN last_indexed_at INTEGER;`)
    }
    if (!cols.some((c) => c.name === 'ephemeral')) {
      sqlite.exec(`ALTER TABLE repos ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0;`)
    }
    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_normalized_url
        ON repos(normalized_url);
    `)
  },
}
