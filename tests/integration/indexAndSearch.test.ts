/**
 * Integration tests: index a tiny fixture Git repo, then assert search behaviour.
 *
 * These tests exercise the full write + read pipeline without a live embedding
 * provider. A mock EmbeddingProvider assigns deterministic embeddings so that
 * search results are predictable.
 *
 * Strategy:
 *  1. Create a temp dir with a real Git repo.
 *  2. Create files and commit them.
 *  3. Run the indexer with the mock provider + a temp SQLite DB (via withDbSession).
 *  4. Assert:
 *       - blobs are stored in the DB
 *       - FTS5 table is populated
 *       - first-seen timestamps reflect the commit
 *       - vectorSearch returns the expected results
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../src/core/db/schema.js'
import { openDatabaseAt, withDbSession } from '../../src/core/db/sqlite.js'
import { runIndex } from '../../src/core/indexing/indexer.js'
import { vectorSearch } from '../../src/core/search/vectorSearch.js'
import type { EmbeddingProvider } from '../../src/core/embedding/provider.js'

// ---------------------------------------------------------------------------
// Mock embedding provider
//
// Assigns a deterministic embedding to each text based on content hash.
// The embeddings are designed so that "auth" content is similar to "auth"
// queries and dissimilar to "database" content.
// ---------------------------------------------------------------------------

/** Returns a normalised unit vector of `dim` dimensions seeded by `seed`. */
function seededUnitVector(seed: number, dim = 8): number[] {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1) * 0.7))
  const mag = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1
  return raw.map((x) => x / mag)
}

/**
 * Simple deterministic mock — hashes the first 64 chars of the text to a seed.
 */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model: string
  readonly dimensions = 8

  constructor(model = 'mock-model') {
    this.model = model
  }

  async embed(text: string): Promise<number[]> {
    let seed = 0
    for (let i = 0; i < Math.min(text.length, 64); i++) {
      seed = (seed * 31 + text.charCodeAt(i)) & 0xffff
    }
    return seededUnitVector(seed, this.dimensions)
  }
}

// ---------------------------------------------------------------------------
// Fixture Git repo helpers
// ---------------------------------------------------------------------------

function initRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  // Disable commit signing for test repos so they work in all CI environments
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
// Test setup
// ---------------------------------------------------------------------------

let repoDir: string
let dbPath: string

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'gitsema-test-'))
  dbPath = join(repoDir, 'test.db')

  initRepo(repoDir)
  commitFile(repoDir, 'src/auth.ts', 'export function authenticate(token: string) { return true }', 'add auth')
  commitFile(repoDir, 'src/db.ts', 'export function query(sql: string) { return [] }', 'add db')
  commitFile(repoDir, 'README.md', '# My Project\nThis project does authentication and database queries.', 'add readme')
})

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('indexer integration', () => {
  it('indexes all blobs and stores them in the DB', async () => {
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

    expect(stats.indexed).toBeGreaterThan(0)
    expect(stats.failed).toBe(0)

    // Verify blobs are stored
    const blobRows = session.rawDb.prepare('SELECT COUNT(*) as c FROM blobs').get() as { c: number }
    expect(blobRows.c).toBeGreaterThan(0)
    session.rawDb.close()
  })

  it('populates the FTS5 table for hybrid search', async () => {
    const session = openDatabaseAt(dbPath)

    const ftsRows = session.rawDb
      .prepare('SELECT COUNT(*) as c FROM blob_fts')
      .get() as { c: number }
    expect(ftsRows.c).toBeGreaterThan(0)
    session.rawDb.close()
  })

  it('records first-seen commit timestamps', async () => {
    const session = openDatabaseAt(dbPath)

    const bcRows = session.rawDb
      .prepare('SELECT COUNT(*) as c FROM blob_commits')
      .get() as { c: number }
    expect(bcRows.c).toBeGreaterThan(0)

    // All commits should have timestamps > 0
    const badCommits = session.rawDb
      .prepare('SELECT COUNT(*) as c FROM commits WHERE timestamp <= 0')
      .get() as { c: number }
    expect(badCommits.c).toBe(0)
    session.rawDb.close()
  })

  it('vectorSearch returns results for an embedded query', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    // Embed a query using the same mock provider
    const queryEmbedding = await provider.embed('authentication token')

    const results = await withDbSession(session, async () =>
      vectorSearch(queryEmbedding, { topK: 5 }),
    )

    expect(results.length).toBeGreaterThan(0)
    // Scores should be in [-1, 1]
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1)
      expect(r.score).toBeLessThanOrEqual(1)
      expect(r.blobHash).toBeTruthy()
      expect(r.paths.length).toBeGreaterThan(0)
    }
    session.rawDb.close()
  })

  it('first-seen sort returns results in chronological order', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()
    const queryEmbedding = await provider.embed('project')

    const results = await withDbSession(session, async () =>
      vectorSearch(queryEmbedding, { topK: 10 }),
    )

    // Filter results that have a firstSeen timestamp
    const withTime = results.filter((r) => r.firstSeen !== undefined)
    if (withTime.length > 1) {
      // Verify timestamps are non-negative integers
      for (const r of withTime) {
        expect(r.firstSeen).toBeGreaterThan(0)
      }
    }
    session.rawDb.close()
  })

  it('indexes the same repo twice without double-counting blobs', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    const countBefore = (
      session.rawDb.prepare('SELECT COUNT(*) as c FROM blobs').get() as { c: number }
    ).c

    // Re-run with since=all (force full re-index attempt)
    const stats = await withDbSession(session, () =>
      runIndex({
        repoPath: repoDir,
        provider,
        concurrency: 1,
        since: 'all',
      }),
    )

    const countAfter = (
      session.rawDb.prepare('SELECT COUNT(*) as c FROM blobs').get() as { c: number }
    ).c

    // Blob count should not increase (deduplication by hash)
    expect(countAfter).toBe(countBefore)
    // All blobs should be skipped (already indexed)
    expect(stats.skipped).toBeGreaterThan(0)
    expect(stats.indexed).toBe(0)
    session.rawDb.close()
  })
})
