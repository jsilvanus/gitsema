import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { openDatabaseAt, withDbSession } from '../../src/core/db/sqlite.js'
import { runIndex } from '../../src/core/indexing/indexer.js'

class MockEmbeddingProvider {
  readonly model = 'mock'
  readonly dimensions = 8
  async embed(text: string): Promise<number[]> {
    let seed = 0
    for (let i = 0; i < Math.min(text.length, 64); i++) seed = (seed * 31 + text.charCodeAt(i)) & 0xffff
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
let _prevProfileEnv: string | undefined
const _isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI)

beforeAll(() => {
  _prevProfileEnv = process.env.GITSEMA_PROFILE_FIRST_RUN
  process.env.GITSEMA_PROFILE_FIRST_RUN = '1'
  repoDir = mkdtempSync(join(tmpdir(), 'gitsema-profile-'))
  dbPath = join(repoDir, 'test.db')
  initRepo(repoDir)
  commitFile(repoDir, 'file.txt', 'hello world', 'add file')
})

afterAll(() => {
  try { rmSync(repoDir, { recursive: true, force: true }) } catch {}
  if (_prevProfileEnv === undefined) delete process.env.GITSEMA_PROFILE_FIRST_RUN
  else process.env.GITSEMA_PROFILE_FIRST_RUN = _prevProfileEnv
})

describe('first-run profiling', () => {
  const maybeIt = _isCI ? it.skip : it
  maybeIt('writes a .cpuprofile into .gitsema/profiles on first index run', async () => {
    const session = openDatabaseAt(dbPath)
    const provider = new MockEmbeddingProvider()

    await withDbSession(session, async () =>
      runIndex({ repoPath: repoDir, provider, concurrency: 1, since: 'all' }),
    )

    const profilesDir = join(repoDir, '.gitsema', 'profiles')
    const files = readdirSync(profilesDir)
    const cpus = files.filter((f) => f.endsWith('.cpuprofile'))
    expect(cpus.length).toBeGreaterThan(0)
  })
})
