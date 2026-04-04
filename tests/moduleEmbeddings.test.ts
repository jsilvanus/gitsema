/**
 * Tests for module-level embeddings (Phase 33).
 *
 * Covers:
 *  1. storeModuleEmbedding / getModuleEmbedding round-trip
 *  2. Indexing with --chunker function populates embeddings table (Level-1 fix)
 *  3. Module embeddings are created for directories
 *  4. vectorSearch with searchModules:true returns module-level results
 *  5. deleteAllModuleEmbeddings + recalculation yields consistent results
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { runIndex } from '../src/core/indexing/indexer.js'
import { vectorSearch } from '../src/core/search/vectorSearch.js'
import { getModuleEmbedding, storeModuleEmbedding, getAllBlobEmbeddingsWithPaths, deleteAllModuleEmbeddings } from '../src/core/indexing/blobStore.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

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

describe('module embeddings — integration', () => {
  let repoDir: string
  let dbPath: string

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'gitsema-mod-test-'))
    dbPath = join(repoDir, 'mod-test.db')

    initRepo(repoDir)

    commitFile(
      repoDir,
      'src/math.ts',
      [
        'export function add(a: number, b: number): number {',
        '  return a + b',
        '}',
      ].join('\n'),
      'add math',
    )

    commitFile(
      repoDir,
      'src/utils/io.ts',
      [
        'export function read(): string {',
        '  return "ok"',
        '}',
      ].join('\n'),
      'add io',
    )
  })

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true })
  })

  it('storeModuleEmbedding / getModuleEmbedding round-trip', async () => {
    const session = openDatabaseAt(dbPath)
    const v = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    await withDbSession(session, async () => {
      // Use a unique path that won't conflict with indexer-produced entries
      storeModuleEmbedding({ modulePath: 'roundtrip-test', model: 'mock-model', embedding: v, blobCount: 2 })
      const got = getModuleEmbedding('roundtrip-test')
      expect(got).not.toBeNull()
      expect(got!.blobCount).toBe(2)
      expect(got!.vector.length).toBe(v.length)
    })
  })

  it('indexing with --chunker function also stores whole-file embeddings', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    await withDbSession(session, () =>
      runIndex({ repoPath: repoDir, provider, concurrency: 1, since: 'all', chunker: 'function' }),
    )

    const embCount = session.rawDb.prepare('SELECT COUNT(*) as c FROM embeddings').get() as { c: number }
    expect(embCount.c).toBeGreaterThan(0)
  })

  it('module embeddings exist after indexing', () => {
    const session = openDatabaseAt(dbPath)
    const row = session.rawDb.prepare('SELECT COUNT(*) as c FROM module_embeddings').get() as { c: number }
    expect(row.c).toBeGreaterThan(0)
  })

  it('vectorSearch with searchModules:true returns module-level results', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()
    const queryEmbedding = await provider.embed('math operations')

    const results = await withDbSession(session, async () =>
      vectorSearch(queryEmbedding, { topK: 10, searchModules: true }),
    )

    expect(results.length).toBeGreaterThan(0)
    const moduleResults = results.filter((r) => r.modulePath !== undefined)
    expect(moduleResults.length).toBeGreaterThan(0)
  })

  it('deleteAllModuleEmbeddings + recompute yields consistent counts', async () => {
    const session = openDatabaseAt(dbPath)
    await withDbSession(session, async () => {
      deleteAllModuleEmbeddings()
      const pre = session.rawDb.prepare('SELECT COUNT(*) as c FROM module_embeddings').get() as { c: number }
      expect(pre.c).toBe(0)

      // Recompute via grouping existing blob embeddings
      const rows = getAllBlobEmbeddingsWithPaths()
      const groups = new Map<string, Array<number[]>>()
      for (const r of rows) {
        const dir = r.path.split('/').slice(0, -1).join('/')
        const list = groups.get(dir) ?? []
        list.push(r.vector)
        groups.set(dir, list)
      }
      for (const [dir, vecs] of groups) {
        const dim = vecs[0].length
        const mean = new Array<number>(dim).fill(0)
        for (const v of vecs) for (let i = 0; i < dim; i++) mean[i] += v[i]
        for (let i = 0; i < dim; i++) mean[i] = mean[i] / vecs.length
        storeModuleEmbedding({ modulePath: dir || '.', model: 'mock-model', embedding: mean, blobCount: vecs.length })
      }

      const post = session.rawDb.prepare('SELECT COUNT(*) as c FROM module_embeddings').get() as { c: number }
      expect(post.c).toBeGreaterThan(0)
    })
  })
})
