import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 8,
  description: 'Add author columns to commits',
  up(sqlite: InstanceType<typeof Database>) {
    const commitCols = sqlite.prepare('PRAGMA table_info(commits)').all() as Array<{ name: string }>
    if (!commitCols.some((c) => c.name === 'author_name')) {
      sqlite.exec(`ALTER TABLE commits ADD COLUMN author_name TEXT`)
    }
    if (!commitCols.some((c) => c.name === 'author_email')) {
      sqlite.exec(`ALTER TABLE commits ADD COLUMN author_email TEXT`)
    }
  },
}
