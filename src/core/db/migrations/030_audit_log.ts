import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 30,
  description: 'Add audit_log table for the identity/authorization audit trail (Phase 125 / multi-tenant-auth §5 Phase D)',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER,
        action TEXT NOT NULL,
        target TEXT,
        org_id INTEGER,
        repo_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_repo ON audit_log(repo_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
    `)
  },
}
