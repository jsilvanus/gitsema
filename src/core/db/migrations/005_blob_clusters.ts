import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 5,
  description: 'Add blob_clusters and cluster_assignments tables',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS blob_clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        centroid BLOB NOT NULL,
        size INTEGER NOT NULL,
        representative_paths TEXT NOT NULL,
        top_keywords TEXT NOT NULL,
        clustered_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cluster_assignments (
        blob_hash TEXT PRIMARY KEY REFERENCES blobs(blob_hash),
        cluster_id INTEGER NOT NULL REFERENCES blob_clusters(id)
      );
    `)
  },
}
