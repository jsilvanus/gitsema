import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runDoctor } from '../src/core/db/doctor.js'

function makeMinimalDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  // Minimal schema needed by doctor
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO meta VALUES ('schema_version', '13');
    CREATE TABLE IF NOT EXISTS blobs (blob_hash TEXT PRIMARY KEY, size INTEGER NOT NULL, indexed_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS embeddings (
      blob_hash TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL, PRIMARY KEY (blob_hash, model)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS blob_fts USING fts5(blob_hash UNINDEXED, content);
    CREATE TABLE IF NOT EXISTS embed_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT, config_hash TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL, model TEXT NOT NULL, code_model TEXT,
      dimensions INTEGER NOT NULL, chunker TEXT NOT NULL,
      window_size INTEGER, overlap INTEGER, created_at INTEGER NOT NULL
    );
  `)
  return db
}

describe('runDoctor', () => {
  it('reports healthy on empty minimal db', () => {
    const db = makeMinimalDb()
    const report = runDoctor(db)
    expect(report.blobCount).toBe(0)
    expect(report.embeddingCount).toBe(0)
    expect(report.integrityCheckPassed).toBe(true)
    expect(report.warnings.filter(w => w.includes('integrity'))).toHaveLength(0)
  })

  it('detects FTS missing rows', () => {
    const db = makeMinimalDb()
    // Insert a blob without a corresponding FTS row
    db.exec(`INSERT INTO blobs VALUES ('abc123', 100, 1000000)`)
    const report = runDoctor(db)
    expect(report.ftsMissingCount).toBe(1)
    expect(report.warnings.some(w => w.includes('FTS'))).toBe(true)
  })

  it('reports embed configs when present', () => {
    const db = makeMinimalDb()
    db.exec(`INSERT INTO embed_config VALUES (1, 'hash1', 'ollama', 'nomic', null, 768, 'file', null, null, 1000000)`)
    const report = runDoctor(db)
    expect(report.embedConfigs).toHaveLength(1)
    expect(report.embedConfigs[0].model).toBe('nomic')
  })
})
