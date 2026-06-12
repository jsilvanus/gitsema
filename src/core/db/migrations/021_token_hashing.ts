import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 21,
  description: 'Hash repo tokens at rest',
  up(sqlite: InstanceType<typeof Database>) {
    const tokenCols = sqlite.prepare('PRAGMA table_info(repo_tokens)').all() as Array<{ name: string }>
    const hasTokenHash = tokenCols.some((c) => c.name === 'token_hash')
    if (!hasTokenHash) {
      const existing = sqlite.prepare('SELECT token, repo_id, label, created_at FROM repo_tokens').all() as Array<{
        token: string; repo_id: string; label: string | null; created_at: number
      }>
      sqlite.pragma('foreign_keys = OFF')
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS repo_tokens_v21 (
          token_hash  TEXT PRIMARY KEY,
          token_prefix TEXT NOT NULL,
          repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
          label       TEXT,
          created_at  INTEGER NOT NULL
        );
      `)
      const insert = sqlite.prepare(
        'INSERT OR IGNORE INTO repo_tokens_v21 (token_hash, token_prefix, repo_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      for (const row of existing) {
        const hash = createHash('sha256').update(row.token).digest('hex')
        const prefix = row.token.slice(0, 8)
        insert.run(hash, prefix, row.repo_id, row.label, row.created_at)
      }
      sqlite.exec(`
        DROP TABLE repo_tokens;
        ALTER TABLE repo_tokens_v21 RENAME TO repo_tokens;
      `)
      sqlite.pragma('foreign_keys = ON')
    }
  },
}
