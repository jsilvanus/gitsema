import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 20,
  description: 'Enforce paths uniqueness',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.exec(`
      DELETE FROM paths
       WHERE id NOT IN (
         SELECT MIN(id) FROM paths GROUP BY blob_hash, path
       );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_paths_blob_path_unique
        ON paths(blob_hash, path);
    `)
  },
}
