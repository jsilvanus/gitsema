import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 31,
  description: 'Add visibility + owner_user_id columns to repos, and a source column to repo_grants (Phase 126 / public-repo-sharing §5 Phase 1)',
  up(sqlite: InstanceType<typeof Database>) {
    const reposExists = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='repos'`)
      .get() as { name: string } | undefined
    if (reposExists) {
      const repoCols = sqlite.prepare(`PRAGMA table_info(repos)`).all() as Array<{ name: string }>
      if (!repoCols.some((c) => c.name === 'visibility')) {
        sqlite.exec(`ALTER TABLE repos ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`)
      }
      if (!repoCols.some((c) => c.name === 'owner_user_id')) {
        sqlite.exec(`ALTER TABLE repos ADD COLUMN owner_user_id INTEGER REFERENCES users(id)`)
      }
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_repos_normalized_url_visibility ON repos(normalized_url, visibility);`)
    }

    const grantsExists = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='repo_grants'`)
      .get() as { name: string } | undefined
    if (grantsExists) {
      const grantCols = sqlite.prepare(`PRAGMA table_info(repo_grants)`).all() as Array<{ name: string }>
      if (!grantCols.some((c) => c.name === 'source')) {
        sqlite.exec(`ALTER TABLE repo_grants ADD COLUMN source TEXT`)
      }
    }
  },
}
