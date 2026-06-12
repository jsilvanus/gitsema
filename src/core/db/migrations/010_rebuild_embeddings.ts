import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 10,
  description: 'Rebuild embedding tables with composite primary keys',
  up(sqlite: InstanceType<typeof Database>) {
    sqlite.pragma('foreign_keys = OFF')
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS embeddings_v10 (
        blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        file_type TEXT,
        PRIMARY KEY (blob_hash, model)
      );
      INSERT OR IGNORE INTO embeddings_v10 SELECT blob_hash, model, dimensions, vector, file_type FROM embeddings;
      DROP TABLE embeddings;
      ALTER TABLE embeddings_v10 RENAME TO embeddings;

      CREATE TABLE IF NOT EXISTS chunk_embeddings_v10 (
        chunk_id INTEGER NOT NULL REFERENCES chunks(id),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (chunk_id, model)
      );
      INSERT OR IGNORE INTO chunk_embeddings_v10 SELECT chunk_id, model, dimensions, vector FROM chunk_embeddings;
      DROP TABLE chunk_embeddings;
      ALTER TABLE chunk_embeddings_v10 RENAME TO chunk_embeddings;

      CREATE TABLE IF NOT EXISTS symbol_embeddings_v10 (
        symbol_id INTEGER NOT NULL REFERENCES symbols(id),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (symbol_id, model)
      );
      INSERT OR IGNORE INTO symbol_embeddings_v10 SELECT symbol_id, model, dimensions, vector FROM symbol_embeddings;
      DROP TABLE symbol_embeddings;
      ALTER TABLE symbol_embeddings_v10 RENAME TO symbol_embeddings;

      CREATE TABLE IF NOT EXISTS commit_embeddings_v10 (
        commit_hash TEXT NOT NULL REFERENCES commits(commit_hash),
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (commit_hash, model)
      );
      INSERT OR IGNORE INTO commit_embeddings_v10 SELECT commit_hash, model, dimensions, vector FROM commit_embeddings;
      DROP TABLE commit_embeddings;
      ALTER TABLE commit_embeddings_v10 RENAME TO commit_embeddings;

      CREATE TABLE IF NOT EXISTS module_embeddings_v10 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_path TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        blob_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (module_path, model)
      );
      INSERT OR IGNORE INTO module_embeddings_v10 SELECT id, module_path, model, dimensions, vector, blob_count, updated_at FROM module_embeddings;
      DROP TABLE module_embeddings;
      ALTER TABLE module_embeddings_v10 RENAME TO module_embeddings;
    `)
    sqlite.pragma('foreign_keys = ON')
  },
}
