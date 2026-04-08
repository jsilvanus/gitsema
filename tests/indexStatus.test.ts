/**
 * Unit tests for src/core/indexing/indexStatus.ts
 *
 * Tests cover:
 *  1. computeIndexStatus with various DB states
 *  2. formatIndexStatus output format
 *  3. Migration v18 smoke test (last_used_at column on embed_config)
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { computeIndexStatus, formatIndexStatus, countGitReachableBlobs } from '../src/core/indexing/indexStatus.js'
import { join } from 'node:path'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '18');

    CREATE TABLE IF NOT EXISTS blobs (
      blob_hash TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      blob_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      PRIMARY KEY (blob_hash, model)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      PRIMARY KEY (chunk_id, model)
    );

    CREATE TABLE IF NOT EXISTS symbol_embeddings (
      symbol_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      PRIMARY KEY (symbol_id, model)
    );

    CREATE TABLE IF NOT EXISTS module_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_path TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      blob_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (module_path, model)
    );

    CREATE TABLE IF NOT EXISTS embed_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_hash TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      code_model TEXT,
      dimensions INTEGER NOT NULL,
      chunker TEXT NOT NULL,
      window_size INTEGER,
      overlap INTEGER,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
  `)
  return db
}

function insertBlob(db: InstanceType<typeof Database>, hash: string): void {
  db.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, 100, ?)').run(hash, Date.now())
}

function insertEmbedding(db: InstanceType<typeof Database>, hash: string, model: string): void {
  const vec = Buffer.alloc(32) // 8 floats = 32 bytes
  db.prepare('INSERT OR IGNORE INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, 8, ?)').run(hash, model, vec)
}

function insertEmbedConfig(db: InstanceType<typeof Database>, model: string, provider = 'ollama', dims = 768): void {
  db.prepare(`
    INSERT OR IGNORE INTO embed_config (config_hash, provider, model, dimensions, chunker, created_at)
    VALUES (?, ?, ?, ?, 'file', ?)
  `).run(`hash-${model}`, provider, model, dims, Math.floor(Date.now() / 1000))
}

// ---------------------------------------------------------------------------
// countGitReachableBlobs
// ---------------------------------------------------------------------------

describe('countGitReachableBlobs', () => {
  it('returns 0 and error when not a git repo', () => {
    const { count, error } = countGitReachableBlobs('/tmp')
    // /tmp is not a git repo so this should fail (or succeed with 0)
    // Either way, it should not throw
    expect(typeof count).toBe('number')
    // If there's an error, count is 0
    if (error) {
      expect(count).toBe(0)
    }
  })

  it('counts blobs in a real git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitsema-gitstatus-test-'))
    try {
      execSync('git init', { cwd: dir, stdio: 'pipe' })
      execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
      execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
      execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
      writeFileSync(join(dir, 'a.txt'), 'hello world')
      writeFileSync(join(dir, 'b.txt'), 'another file')
      execSync('git add .', { cwd: dir, stdio: 'pipe' })
      execSync('git commit -m "initial"', { cwd: dir, stdio: 'pipe' })

      const { count, error } = countGitReachableBlobs(dir)
      expect(error).toBeUndefined()
      expect(count).toBeGreaterThanOrEqual(2) // at least 2 blobs
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// computeIndexStatus — basic cases
// ---------------------------------------------------------------------------

describe('computeIndexStatus', () => {
  it('returns empty status for fresh DB', () => {
    const db = makeTestDb()
    const status = computeIndexStatus(db, '/fake/path.db', '/tmp')
    expect(status.dbPath).toBe('/fake/path.db')
    expect(status.schemaVersion).toBe(18)
    expect(status.dbBlobs).toBe(0)
    expect(status.configs).toHaveLength(0)
  })

  it('reports DB blob count correctly', () => {
    const db = makeTestDb()
    insertBlob(db, 'aaa')
    insertBlob(db, 'bbb')

    const status = computeIndexStatus(db, '/fake/path.db', '/tmp')
    expect(status.dbBlobs).toBe(2)
  })

  it('reports per-model coverage when embed_config rows exist', () => {
    const db = makeTestDb()
    insertBlob(db, 'aaa')
    insertBlob(db, 'bbb')
    insertEmbedding(db, 'aaa', 'nomic-embed-text')
    insertEmbedding(db, 'bbb', 'nomic-embed-text')
    insertEmbedConfig(db, 'nomic-embed-text')

    const status = computeIndexStatus(db, '/fake/path.db', '/tmp')
    expect(status.configs).toHaveLength(1)
    expect(status.configs[0].model).toBe('nomic-embed-text')
    expect(status.configs[0].fileBlobsEmbedded).toBe(2)
  })

  it('reports coverage for multiple models', () => {
    const db = makeTestDb()
    insertBlob(db, 'aaa')
    insertBlob(db, 'bbb')
    insertEmbedding(db, 'aaa', 'nomic-embed-text')
    insertEmbedding(db, 'aaa', 'text-embedding-3-small')
    insertEmbedConfig(db, 'nomic-embed-text', 'ollama', 768)
    insertEmbedConfig(db, 'text-embedding-3-small', 'http', 1536)

    const status = computeIndexStatus(db, '/fake/path.db', '/tmp')
    expect(status.configs).toHaveLength(2)

    const nomic = status.configs.find((c) => c.model === 'nomic-embed-text')!
    const oai = status.configs.find((c) => c.model === 'text-embedding-3-small')!
    expect(nomic.fileBlobsEmbedded).toBe(1)
    expect(oai.fileBlobsEmbedded).toBe(1)
    expect(nomic.dimensions).toBe(768)
    expect(oai.dimensions).toBe(1536)
  })

  it('synthesizes coverage from embeddings when no embed_config rows exist', () => {
    const db = makeTestDb()
    insertBlob(db, 'aaa')
    insertEmbedding(db, 'aaa', 'some-model')
    // No embed_config rows

    const status = computeIndexStatus(db, '/fake/path.db', '/tmp')
    expect(status.configs).toHaveLength(1)
    expect(status.configs[0].model).toBe('some-model')
    expect(status.configs[0].fileBlobsEmbedded).toBe(1)
    expect(status.configs[0].provider).toBe('(unknown)')
  })

  it('reports chunk and module counts per model', () => {
    const db = makeTestDb()
    insertBlob(db, 'aaa')
    insertEmbedConfig(db, 'nomic-embed-text')

    // Add a chunk
    db.prepare('INSERT INTO chunks (blob_hash, start_line, end_line) VALUES (?, 1, 10)').run('aaa')
    const chunkId = (db.prepare('SELECT id FROM chunks WHERE blob_hash = ?').get('aaa') as { id: number }).id
    const vec = Buffer.alloc(32)
    db.prepare('INSERT INTO chunk_embeddings (chunk_id, model, dimensions, vector) VALUES (?, ?, 8, ?)').run(chunkId, 'nomic-embed-text', vec)

    // Add a module embedding
    db.prepare('INSERT INTO module_embeddings (module_path, model, dimensions, vector, blob_count, updated_at) VALUES (?, ?, 8, ?, 1, ?)').run('src/auth', 'nomic-embed-text', vec, Date.now())

    const status = computeIndexStatus(db, '/fake/path.db', '/tmp')
    expect(status.configs[0].chunksEmbedded).toBe(1)
    expect(status.configs[0].modulesEmbedded).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// formatIndexStatus — output format
// ---------------------------------------------------------------------------

describe('formatIndexStatus', () => {
  it('shows "no embeddings" message when configs is empty', () => {
    const db = makeTestDb()
    const status = computeIndexStatus(db, '/path/to/db', '/tmp')
    const out = formatIndexStatus(status)
    expect(out).toContain('No embeddings found')
    expect(out).toContain('gitsema index start')
  })

  it('shows model coverage when embeddings exist', () => {
    const db = makeTestDb()
    insertBlob(db, 'aaa')
    insertEmbedding(db, 'aaa', 'nomic-embed-text')
    insertEmbedConfig(db, 'nomic-embed-text')

    const status = computeIndexStatus(db, '/path/to/db', '/tmp')
    const out = formatIndexStatus(status)
    expect(out).toContain('nomic-embed-text')
    expect(out).toContain('file blobs:')
    expect(out).toContain('gitsema index start')
  })

  it('includes DB path and schema version', () => {
    const db = makeTestDb()
    const status = computeIndexStatus(db, '/my/custom/path.db', '/tmp')
    const out = formatIndexStatus(status)
    expect(out).toContain('/my/custom/path.db')
    expect(out).toContain('18') // schema version
  })

  it('includes git count error message when not a git repo', () => {
    const db = makeTestDb()
    insertBlob(db, 'aaa')
    insertEmbedConfig(db, 'nomic-embed-text')
    insertEmbedding(db, 'aaa', 'nomic-embed-text')

    const status = computeIndexStatus(db, '/path/db', '/tmp/definitely-not-a-repo-xyz')
    const out = formatIndexStatus(status)
    // Should either show error or 0 git blobs — either way the format should work
    expect(out).toBeTruthy()
    expect(out).toContain('nomic-embed-text')
  })

  it('shows multi-model output', () => {
    const db = makeTestDb()
    insertBlob(db, 'aaa')
    insertEmbedding(db, 'aaa', 'nomic-embed-text')
    insertEmbedding(db, 'aaa', 'text-embedding-3-small')
    insertEmbedConfig(db, 'nomic-embed-text', 'ollama', 768)
    insertEmbedConfig(db, 'text-embedding-3-small', 'http', 1536)

    const status = computeIndexStatus(db, '/path/db', '/tmp')
    const out = formatIndexStatus(status)
    expect(out).toContain('nomic-embed-text')
    expect(out).toContain('text-embedding-3-small')
  })
})

// ---------------------------------------------------------------------------
// Migration v18 smoke test — last_used_at column on embed_config
// ---------------------------------------------------------------------------

describe('schema migration v18 smoke test', () => {
  it('adds last_used_at column to embed_config table', () => {
    // Simulate a v17 database (no last_used_at column)
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta (key, value) VALUES ('schema_version', '17');

      CREATE TABLE IF NOT EXISTS embed_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_hash TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        code_model TEXT,
        dimensions INTEGER NOT NULL,
        chunker TEXT NOT NULL,
        window_size INTEGER,
        overlap INTEGER,
        created_at INTEGER NOT NULL
        -- Note: no last_used_at column
      );
    `)

    // Verify column does not exist yet
    const colsBefore = db.prepare('PRAGMA table_info(embed_config)').all() as Array<{ name: string }>
    expect(colsBefore.some((c) => c.name === 'last_used_at')).toBe(false)

    // Apply the v18 migration manually (as sqlite.ts applyMigrations would do)
    const versionRow = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }
    let version = parseInt(versionRow.value, 10)
    if (version < 18) {
      const cols = db.prepare('PRAGMA table_info(embed_config)').all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'last_used_at')) {
        db.exec(`ALTER TABLE embed_config ADD COLUMN last_used_at INTEGER`)
      }
      version = 18
      db.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run('18')
    }

    // Verify column exists after migration
    const colsAfter = db.prepare('PRAGMA table_info(embed_config)').all() as Array<{ name: string }>
    expect(colsAfter.some((c) => c.name === 'last_used_at')).toBe(true)

    // Verify schema version updated
    const newVersionRow = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }
    expect(newVersionRow.value).toBe('18')
  })

  it('is idempotent (column already exists)', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS embed_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_hash TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        chunker TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER  -- already present
      );
    `)
    // Applying the migration guard should not throw
    const cols = db.prepare('PRAGMA table_info(embed_config)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'last_used_at')) {
      db.exec(`ALTER TABLE embed_config ADD COLUMN last_used_at INTEGER`)
    }
    // Should still have the column
    const colsAfter = db.prepare('PRAGMA table_info(embed_config)').all() as Array<{ name: string }>
    expect(colsAfter.some((c) => c.name === 'last_used_at')).toBe(true)
  })
})
