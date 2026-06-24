import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 32,
  description: 'Add profile_name column to repos for multi-profile embedding serving (Phase 128 / locked-model-set-plan.md §5 Phase 1)',
  up(sqlite: InstanceType<typeof Database>) {
    const reposExists = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='repos'`)
      .get() as { name: string } | undefined
    if (reposExists) {
      const repoCols = sqlite.prepare(`PRAGMA table_info(repos)`).all() as Array<{ name: string }>
      if (!repoCols.some((c) => c.name === 'profile_name')) {
        sqlite.exec(`ALTER TABLE repos ADD COLUMN profile_name TEXT`)
      }
    }
  },
}
