/**
 * Integration test: `gitsema index doctor --fix` auto-repairs fixable issues
 * (missing FTS content) and re-reports index health.
 *
 * Uses a real Git repo + real SQLite DB so `backfillFts` can re-fetch blob
 * content via `git cat-file` and `rebuildFts` can trigger a real FTS5 rebuild.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { getRawDb } from '../../src/core/db/sqlite.js'
import { runIndex } from '../../src/core/indexing/indexer.js'
import { doctorCommand } from '../../src/cli/commands/doctor.js'
import { runDoctor } from '../../src/core/db/doctor.js'
import type { EmbeddingProvider } from '../../src/core/embedding/provider.js'

function seededUnitVector(seed: number, dim = 8): number[] {
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1) * 0.7))
  const mag = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1
  return raw.map((x) => x / mag)
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'mock-doctor-fix-model'
  readonly dimensions = 8

  async embed(text: string): Promise<number[]> {
    let seed = 0
    for (let i = 0; i < Math.min(text.length, 64); i++) {
      seed = (seed * 31 + text.charCodeAt(i)) & 0xffff
    }
    return seededUnitVector(seed, this.dimensions)
  }
}

let repoDir: string
let origCwd: string

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'gitsema-doctor-fix-'))
  execSync('git init', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config gpg.format openpgp', { cwd: repoDir, stdio: 'pipe' })
  writeFileSync(join(repoDir, 'auth.ts'), 'export function login() {}', 'utf8')
  execSync('git add auth.ts', { cwd: repoDir, stdio: 'pipe' })
  execSync('git commit -m "add auth"', { cwd: repoDir, stdio: 'pipe' })

  origCwd = process.cwd()
  process.chdir(repoDir)
})

afterAll(() => {
  process.chdir(origCwd)
  // Windows CI occasionally hits EBUSY here from a transient lock left by the
  // git subprocesses spawned in beforeAll (see profileFirstRun.test.ts for
  // the same pattern) — cleanup best-effort, not test-critical.
  try {
    rmSync(repoDir, { recursive: true, force: true })
  } catch {}
})

describe('doctorCommand — --fix', () => {
  it('backfills missing FTS content and re-reports a clean state', async () => {
    // No explicit session override: relies on the lazily-created default
    // session (`.gitsema/index.db` relative to cwd), the same one
    // `doctorCommand`'s `getRawDb()` reads from.
    const provider = new MockEmbeddingProvider()
    await runIndex({ repoPath: repoDir, provider, since: 'all', concurrency: 1 })

    const rawDb = getRawDb()
    // Simulate blobs indexed before FTS5 support: strip all blob_fts rows.
    rawDb.exec('DELETE FROM blob_fts')

    const before = runDoctor(rawDb)
    expect(before.ftsMissingCount).toBeGreaterThan(0)

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))

    try {
      await doctorCommand({ fix: true })
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('Applying fixes')
    expect(output).toContain('Post-fix report')

    const after = runDoctor(rawDb)
    expect(after.ftsMissingCount).toBe(0)
  })
})
