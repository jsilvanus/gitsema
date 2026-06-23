import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 29,
  description: 'Add sso_identities table for linked external OIDC/SSO identities (Phase 124 / multi-tenant-auth §5 Phase C)',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sso_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        linked_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sso_identities_provider_external
        ON sso_identities(provider, external_id);
      CREATE INDEX IF NOT EXISTS idx_sso_identities_user ON sso_identities(user_id);
    `)
  },
}
