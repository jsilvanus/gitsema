import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { openDatabaseAt, withDbSession } from '../../src/core/db/sqlite.js'
import { runIndex } from '../../src/core/indexing/indexer.js'
import { parseDateArg } from '../../src/core/search/temporal/timeSearch.js'
import { vectorSearch } from '../../src/core/search/vectorSearch.js'

/** Minimal deterministic mock embedding provider used by the indexer in tests */
class MockEmbeddingProvider {
  readonly model = 'mock'
  readonly dimensions = 8
  async embed(text: string): Promise<number[]> {
    const seed = Array.from(text).slice(0, 64).reduce((s, c) => (s * 31 + c.charCodeAt(0)) & 0xffff, 0)
    const raw = Array.from({ length: this.dimensions }, (_, i) => Math.sin(seed * (i + 1) * 0.7))
    const mag = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1
    return raw.map((x) => x / mag)
  }
}

function initRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' })
}

function commitFile(dir: string, relPath: string, content: string, message: string): string {
  const fullPath = join(dir, relPath)
  mkdirSync(join(dir, relPath.split('/').slice(0, -1).join('/')), { recursive: true })
  writeFileSync(fullPath, content, 'utf8')
  execSync(`git add "${relPath}"`, { cwd: dir, stdio: 'pipe' })
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'pipe' })
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim()
}

let repoDir: string
let dbPath: string

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'gitsema-time-'))
  dbPath = join(repoDir, 'test.db')
  initRepo(repoDir)
  // commit A
  commitFile(repoDir, 'note.txt', 'A', 'v1')
  // commit B
  const h2 = commitFile(repoDir, 'note.txt', 'B', 'v2')
  // commit A again (reintroduce original blob)
  commitFile(repoDir, 'note.txt', 'A', 'v3')
})

afterAll(() => {
  try {
    rmSync(repoDir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup — ignore permission/locking races on Windows
  }
})

describe('temporal filtering (last-seen semantics)', () => {
  it('includes a blob reintroduced at HEAD when filtering by after=mid-commit', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    await withDbSession(session, async () =>
      runIndex({ repoPath: repoDir, provider, concurrency: 1, since: 'all' }),
    )

    // pick the timestamp of the middle commit (v2)
    const midHash = execSync('git rev-parse HEAD~1', { cwd: repoDir, encoding: 'utf8' }).trim()
    const tMid = parseInt(execSync(`git show -s --format=%ct ${midHash}`, { cwd: repoDir, encoding: 'utf8' }).trim(), 10)
    const after = tMid - 1

    // Run a vector search with an embedding closely matching the "A" content
    // Verify last-seen aggregation via SQL: the HEAD blob's last_seen should be > mid commit
    await withDbSession(session, async () => {
      const rows = session.rawDb.prepare(
        `SELECT blob_hash FROM (
           SELECT blob_hash, MAX(commits.timestamp) AS last_seen
           FROM blob_commits
           JOIN commits ON blob_commits.commit_hash = commits.commit_hash
           GROUP BY blob_hash
         ) WHERE last_seen > ?`
      ).all(after) as Array<{ blob_hash: string }>
      const headBlob = execSync('git rev-parse HEAD:note.txt', { cwd: repoDir, encoding: 'utf8' }).trim()
      const hashes = rows.map((r) => r.blob_hash)
      expect(hashes).toContain(headBlob)
    })
    session.rawDb.close()
  })

  it('parseDateArg resolves git refs (HEAD and HEAD~1) when DB session active', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()
    await withDbSession(session, async () => runIndex({ repoPath: repoDir, provider, concurrency: 1, since: 'all' }))

    // parseDateArg consults the active DB/session and falls back to git
    await withDbSession(session, async () => {
      const tHead = parseDateArg('HEAD')
      const tHead1 = parseDateArg('HEAD~1')
      expect(typeof tHead).toBe('number')
      expect(typeof tHead1).toBe('number')
      expect(tHead).toBeGreaterThanOrEqual(tHead1)
    })

    session.rawDb.close()
  })
})
