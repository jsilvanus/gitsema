import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 26,
  description: 'Add graph_nodes and edges tables for the structural linking pass (Phase 107 / knowledge-graph §3.3)',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        node_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        path TEXT,
        repo_id TEXT,
        current_blob_hash TEXT,
        is_external INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS edges (
        src_key TEXT NOT NULL REFERENCES graph_nodes(node_key),
        dst_key TEXT NOT NULL REFERENCES graph_nodes(node_key),
        edge_type TEXT NOT NULL,
        weight REAL DEFAULT 1,
        confidence REAL DEFAULT 1,
        first_seen_commit TEXT,
        last_seen_commit TEXT,
        observed_count INTEGER DEFAULT 1,
        PRIMARY KEY (src_key, dst_key, edge_type)
      );

      CREATE INDEX IF NOT EXISTS idx_edges_src_type ON edges(src_key, edge_type);
      CREATE INDEX IF NOT EXISTS idx_edges_dst_type ON edges(dst_key, edge_type);
    `)
  },
}
