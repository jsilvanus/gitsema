/**
 * Tests for commit message embeddings (Phase 28).
 *
 * Covers:
 *  1. storeCommitEmbedding() writes to the commit_embeddings table
 *  2. Duplicate inserts are silently ignored (idempotent)
 *  3. indexer embeds commit messages in Phase B and populates commit_embeddings
 *  4. searchCommits() returns ranked CommitSearchResult items
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { runIndex } from '../src/core/indexing/indexer.js'
import { storeCommitEmbedding } from '../src/core/indexing/blobStore.js'
import { searchCommits } from '../src/core/search/commitSearch.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

// ---------------------------------------------------------------------------
// Mock embedding provider
// ---------------------------------------------------------------------------

function seededUnitVector(seed: number, dim = 8): number[] {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1) * 0.7))
  const mag = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1
  return raw.map((x) => x / mag)
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'mock-model'
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
  const parts = relPath.split('/')
  if (parts.length > 1) {
    mkdirSync(join(dir, parts.slice(0, -1).join('/')), { recursive: true })
  }
  writeFileSync(join(dir, relPath), content, 'utf8')
  execSync(`git add "${relPath}"`, { cwd: dir, stdio: 'pipe' })
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'pipe' })
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim()
}

// ---------------------------------------------------------------------------
// Unit tests: storeCommitEmbedding
// ---------------------------------------------------------------------------

describe('storeCommitEmbedding', () => {
  let tmpDir: string
  let dbPath: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-cemb-unit-'))
    dbPath = join(tmpDir, 'test.db')
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('inserts a row into commit_embeddings', async () => {
    const session = openDatabaseAt(dbPath)

    // Insert a commit row first (FK requirement)
    session.rawDb
      .prepare(
        'INSERT OR IGNORE INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)',
      )
      .run('deadbeef01deadbeef01deadbeef01deadbeef01', 1700000000, 'fix auth token validation')

    const embedding = seededUnitVector(42, 8)
    await withDbSession(session, async () => {
      storeCommitEmbedding({
        commitHash: 'deadbeef01deadbeef01deadbeef01deadbeef01',
        model: 'mock-model',
        embedding,
      })
    })

    const row = session.rawDb
      .prepare('SELECT * FROM commit_embeddings WHERE commit_hash = ?')
      .get('deadbeef01deadbeef01deadbeef01deadbeef01') as {
        commit_hash: string; model: string; dimensions: number; vector: Buffer
      } | undefined

    expect(row).toBeDefined()
    expect(row!.model).toBe('mock-model')
    expect(row!.dimensions).toBe(8)
    expect(row!.vector.byteLength).toBe(8 * 4) // Float32 × 8 dims
  })

  it('is idempotent — duplicate inserts are silently ignored', async () => {
    const session = openDatabaseAt(dbPath)
    const embedding = seededUnitVector(42, 8)

    // Insert same embedding twice — should not throw
    await withDbSession(session, async () => {
      storeCommitEmbedding({
        commitHash: 'deadbeef01deadbeef01deadbeef01deadbeef01',
        model: 'mock-model',
        embedding,
      })
      storeCommitEmbedding({
        commitHash: 'deadbeef01deadbeef01deadbeef01deadbeef01',
        model: 'mock-model',
        embedding,
      })
    })

    const count = (
      session.rawDb
        .prepare(
          'SELECT COUNT(*) as c FROM commit_embeddings WHERE commit_hash = ?',
        )
        .get('deadbeef01deadbeef01deadbeef01deadbeef01') as { c: number }
    ).c

    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Integration tests: indexer populates commit_embeddings; searchCommits works
// ---------------------------------------------------------------------------

describe('indexer — commit message embeddings (integration)', () => {
  let repoDir: string
  let dbPath: string

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'gitsema-cemb-int-'))
    dbPath = join(repoDir, 'cemb-test.db')

    initRepo(repoDir)

    commitFile(
      repoDir,
      'src/auth.ts',
      `export function verifyToken(token: string): boolean {
  return token.length > 0
}`,
      'feat: add authentication token verification',
    )

    commitFile(
      repoDir,
      'src/db.ts',
      `export function connectDatabase(url: string): void {
  if (!url) throw new Error('url required')
}`,
      'fix: validate database connection URL on startup',
    )

    commitFile(
      repoDir,
      'src/api.ts',
      `export function handleRequest(req: unknown): string {
  return JSON.stringify(req)
}`,
      'refactor: simplify API request handler',
    )
  })

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true })
  })

  it('populates commit_embeddings after indexing', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    const stats = await withDbSession(session, () =>
      runIndex({
        repoPath: repoDir,
        provider,
        concurrency: 1,
        since: 'all',
      }),
    )

    expect(stats.failed).toBe(0)
    expect(stats.commits).toBeGreaterThan(0)
    expect(stats.commitEmbeddings).toBeGreaterThan(0)
    expect(stats.commitEmbedFailed).toBe(0)

    const count = (
      session.rawDb
        .prepare('SELECT COUNT(*) as c FROM commit_embeddings')
        .get() as { c: number }
    ).c

    expect(count).toBeGreaterThan(0)
    expect(count).toBe(stats.commitEmbeddings)
  })

  it('searchCommits returns ranked results', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    const queryEmbedding = await provider.embed('authentication token verification')

    const results = await withDbSession(session, async () =>
      searchCommits(queryEmbedding, { topK: 5 }),
    )

    expect(results.length).toBeGreaterThan(0)

    // Each result must have required fields
    for (const r of results) {
      expect(typeof r.commitHash).toBe('string')
      expect(r.commitHash).toMatch(/^[0-9a-f]{40,64}$/)
      expect(typeof r.message).toBe('string')
      expect(r.message.length).toBeGreaterThan(0)
      expect(typeof r.timestamp).toBe('number')
      expect(r.timestamp).toBeGreaterThan(0)
      expect(typeof r.score).toBe('number')
      expect(r.score).toBeGreaterThanOrEqual(-1)
      expect(r.score).toBeLessThanOrEqual(1)
      expect(Array.isArray(r.paths)).toBe(true)
    }

    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
    }
  })

  it('searchCommits returns empty array when no commit_embeddings exist', async () => {
    // Use a fresh empty DB
    const emptyDbPath = join(repoDir, 'empty.db')
    const session = openDatabaseAt(emptyDbPath)
    const provider = new MockEmbeddingProvider()
    const queryEmbedding = await provider.embed('authentication')

    const results = await withDbSession(session, async () =>
      searchCommits(queryEmbedding, { topK: 5 }),
    )

    expect(results).toEqual([])
  })

  it('commit embeddings are not duplicated on re-index', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    const countBefore = (
      session.rawDb.prepare('SELECT COUNT(*) as c FROM commit_embeddings').get() as { c: number }
    ).c

    // Re-run the indexer (commits already indexed — should not add duplicate rows)
    await withDbSession(session, () =>
      runIndex({
        repoPath: repoDir,
        provider,
        concurrency: 1,
        since: 'all',
      }),
    )

    const countAfter = (
      session.rawDb.prepare('SELECT COUNT(*) as c FROM commit_embeddings').get() as { c: number }
    ).c

    expect(countAfter).toBe(countBefore)
  })
})
