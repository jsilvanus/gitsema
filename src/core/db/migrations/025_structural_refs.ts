import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 25,
  description: 'Add structural_refs table for per-blob structural extraction (Phase 106 / knowledge-graph §3.2)',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS structural_refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
        enclosing_qualified_name TEXT,
        ref_kind TEXT NOT NULL,
        raw_target TEXT NOT NULL,
        target_module TEXT,
        line INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_structural_refs_blob_hash ON structural_refs(blob_hash);
      CREATE INDEX IF NOT EXISTS idx_structural_refs_kind_target ON structural_refs(ref_kind, raw_target);
    `)
  },
}
