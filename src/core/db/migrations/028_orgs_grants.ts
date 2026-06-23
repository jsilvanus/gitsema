import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 28,
  description: 'Add orgs, org_members, repo_grants tables and repos.org_id column for org/grant authorization (Phase 123 / multi-tenant-auth §5 Phase B)',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS orgs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS org_members (
        org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (org_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);

      CREATE TABLE IF NOT EXISTS repo_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        branch_pattern TEXT,
        granted_by INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_grants_user_repo_branch
        ON repo_grants(user_id, repo_id, branch_pattern);
      CREATE INDEX IF NOT EXISTS idx_repo_grants_repo ON repo_grants(repo_id);
    `)

    const reposExists = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='repos'`)
      .get() as { name: string } | undefined
    if (reposExists) {
      const cols = sqlite.prepare('PRAGMA table_info(repos)').all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'org_id')) {
        sqlite.exec(`ALTER TABLE repos ADD COLUMN org_id INTEGER REFERENCES orgs(id);`)
      }
    }
  },
}
