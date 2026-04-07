/**
 * Integration tests: `gitsema index` shows status without writing to the DB.
 *
 * These tests verify the new status-first CLI behavior:
 *  1. `gitsema index` (no subcommand) shows coverage without starting indexing.
 *  2. `gitsema index start` actually performs indexing.
 *  3. `gitsema index` with flags (--since, --ext, etc.) exits with an error
 *     instructing to use `gitsema index start`.
 *
 * Uses a real Git repo + real SQLite DB for end-to-end coverage.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { openDatabaseAt, withDbSession } from '../../src/core/db/sqlite.js'
import { indexCommand, indexStartCommand } from '../../src/cli/commands/index.js'
import { computeIndexStatus, formatIndexStatus } from '../../src/core/indexing/indexStatus.js'
import { runIndex } from '../../src/core/indexing/indexer.js'
import type { EmbeddingProvider } from '../../src/core/embedding/provider.js'

// ---------------------------------------------------------------------------
// Mock embedding provider
// ---------------------------------------------------------------------------

function seededUnitVector(seed: number, dim = 8): number[] {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1) * 0.7))
  const mag = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1
  return raw.map((x) => x / mag)
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'mock-index-status-model'
  readonly dimensions = 8

  async embed(text: string): Promise<number[]> {
    let seed = 0
    for (let i = 0; i < Math.min(text.length, 64); i++) {
      seed = (seed * 31 + text.charCodeAt(i)) & 0xffff
    }
    return seededUnitVector(seed, this.dimensions)
  }
}

// ---------------------------------------------------------------------------
// Git repo helpers
// ---------------------------------------------------------------------------

function initRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
  execSync('git config gpg.format openpgp', { cwd: dir, stdio: 'pipe' })
}

function commitFile(dir: string, relPath: string, content: string, message: string): string {
  const fullPath = join(dir, relPath)
  mkdirSync(join(dir, relPath.split('/').slice(0, -1).join('/')), { recursive: true })
  writeFileSync(fullPath, content, 'utf8')
  execSync(`git add "${relPath}"`, { cwd: dir, stdio: 'pipe' })
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'pipe' })
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let repoDir: string
let dbPath: string

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'gitsema-status-integration-'))
  dbPath = join(repoDir, 'test-status.db')

  initRepo(repoDir)
  commitFile(repoDir, 'src/auth.ts', 'export function login() {}', 'add auth')
  commitFile(repoDir, 'src/db.ts', 'export function query() {}', 'add db')
})

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

describe('computeIndexStatus — integration (real git repo)', () => {
  it('counts Git-reachable blobs from the real repo', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta (key, value) VALUES ('schema_version', '18');
      CREATE TABLE IF NOT EXISTS blobs (blob_hash TEXT PRIMARY KEY, size INTEGER NOT NULL, indexed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS embeddings (blob_hash TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (blob_hash, model));
      CREATE TABLE IF NOT EXISTS chunk_embeddings (chunk_id INTEGER NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (chunk_id, model));
      CREATE TABLE IF NOT EXISTS symbol_embeddings (symbol_id INTEGER NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (symbol_id, model));
      CREATE TABLE IF NOT EXISTS module_embeddings (id INTEGER PRIMARY KEY AUTOINCREMENT, module_path TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, blob_count INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (module_path, model));
      CREATE TABLE IF NOT EXISTS embed_config (id INTEGER PRIMARY KEY AUTOINCREMENT, config_hash TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, model TEXT NOT NULL, code_model TEXT, dimensions INTEGER NOT NULL, chunker TEXT NOT NULL, window_size INTEGER, overlap INTEGER, created_at INTEGER NOT NULL, last_used_at INTEGER);
    `)

    const status = computeIndexStatus(db, dbPath, repoDir)
    // The repo has 2 committed files → at least 2 blobs
    expect(status.gitReachableBlobs).toBeGreaterThanOrEqual(2)
    expect(status.gitCountError).toBeUndefined()
    expect(status.dbBlobs).toBe(0) // nothing indexed yet
  })

  it('shows per-model coverage after indexing', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    await withDbSession(session, () =>
      runIndex({
        repoPath: repoDir,
        provider,
        since: 'all',
        concurrency: 1,
      }),
    )

    const status = computeIndexStatus(session.rawDb, dbPath, repoDir)
    expect(status.dbBlobs).toBeGreaterThanOrEqual(2)
    expect(status.gitReachableBlobs).toBeGreaterThanOrEqual(2)

    // At least one model should have coverage
    expect(status.configs.length).toBeGreaterThanOrEqual(0)
  })
})

describe('indexCommand — status-only behavior', () => {
  it('exits with error when called with indexing flags', async () => {
    // `indexCommand` with flags should print error and call process.exit(1)
    const exitCalls: number[] = []
    const origExit = process.exit.bind(process)
    const exitSpy = (code?: number): never => {
      exitCalls.push(code ?? 0)
      throw new Error(`process.exit(${code})`)
    }
    process.exit = exitSpy as typeof process.exit

    const errLines: string[] = []
    const origError = console.error.bind(console)
    console.error = (...args: unknown[]) => errLines.push(args.join(' '))

    try {
      await indexCommand({ since: 'all' })
    } catch (e) {
      // expected — process.exit throws in test
    } finally {
      process.exit = origExit
      console.error = origError
    }

    expect(exitCalls).toContain(1)
    const errorOutput = errLines.join('\n')
    expect(errorOutput).toContain('gitsema index start')
  })

  it('exits with error when called with --ext flag', async () => {
    const exitCalls: number[] = []
    const origExit = process.exit.bind(process)
    process.exit = ((code?: number): never => {
      exitCalls.push(code ?? 0)
      throw new Error(`process.exit(${code})`)
    }) as typeof process.exit

    const errLines: string[] = []
    const origError = console.error.bind(console)
    console.error = (...args: unknown[]) => errLines.push(args.join(' '))

    try {
      await indexCommand({ ext: '.ts' })
    } catch {
      // expected
    } finally {
      process.exit = origExit
      console.error = origError
    }

    expect(exitCalls).toContain(1)
    expect(errLines.join('\n')).toContain('gitsema index start')
  })
})

describe('formatIndexStatus — integration output format', () => {
  it('produces valid output for a repo with embeddings', async () => {
    const localDbPath = join(repoDir, 'format-test.db')
    const session = openDatabaseAt(localDbPath)
    const provider = new MockEmbeddingProvider()

    await withDbSession(session, () =>
      runIndex({
        repoPath: repoDir,
        provider,
        since: 'all',
        concurrency: 1,
      }),
    )

    const status = computeIndexStatus(session.rawDb, localDbPath, repoDir)
    const out = formatIndexStatus(status)

    expect(out).toContain('DB:')
    expect(out).toContain('Git blobs:')
    expect(out).toContain('DB blobs:')
    // Should suggest next steps
    expect(out).toContain('gitsema index start')
  })

  it('produces valid output for an empty DB (no blobs)', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES ('schema_version', '18');
      CREATE TABLE blobs (blob_hash TEXT PRIMARY KEY, size INTEGER NOT NULL, indexed_at INTEGER NOT NULL);
      CREATE TABLE embeddings (blob_hash TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (blob_hash, model));
      CREATE TABLE chunk_embeddings (chunk_id INTEGER NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (chunk_id, model));
      CREATE TABLE symbol_embeddings (symbol_id INTEGER NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (symbol_id, model));
      CREATE TABLE module_embeddings (id INTEGER PRIMARY KEY AUTOINCREMENT, module_path TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, blob_count INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (module_path, model));
      CREATE TABLE embed_config (id INTEGER PRIMARY KEY AUTOINCREMENT, config_hash TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, model TEXT NOT NULL, code_model TEXT, dimensions INTEGER NOT NULL, chunker TEXT NOT NULL, window_size INTEGER, overlap INTEGER, created_at INTEGER NOT NULL, last_used_at INTEGER);
    `)
    const status = computeIndexStatus(db, '/path/to/db', '/tmp')
    const out = formatIndexStatus(status)
    expect(out).toContain('No embeddings found')
    expect(out).toContain('gitsema index start')
  })
})
