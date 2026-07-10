import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { runGit, UnsafeGitRefError } from '../../src/core/git/runGit.js'
import { resolveRefToTimestamp } from '../../src/core/search/clustering/clustering.js'

/**
 * Phase 150 / review11 §2.1 regression suite. The git argument-injection
 * class: `execFileSync('git', [...])` defeats shell metacharacters but NOT
 * git's own option parser — a "ref" beginning with `-` is parsed as a flag.
 * `git log --output=<file>` is then an arbitrary-file-write primitive
 * reachable from `semantic_bisect`/`triage`. These tests assert the sinks
 * reject leading-`-` refs (and never write the PoC file).
 */

let repoDir: string

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'gitsema-rungit-'))
  execSync('git init', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config commit.gpgsign false', { cwd: repoDir, stdio: 'pipe' })
  writeFileSync(join(repoDir, 'f.txt'), 'hello', 'utf8')
  execSync('git add f.txt', { cwd: repoDir, stdio: 'pipe' })
  execSync('git commit -m init', { cwd: repoDir, stdio: 'pipe' })
})

afterAll(() => {
  try {
    rmSync(repoDir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

describe('runGit', () => {
  it('rejects a leading-dash ref before spawning git', () => {
    expect(() => runGit('log', ['-1', '--format=%ct'], ['--output=pwned.txt'], { cwd: repoDir }))
      .toThrow(UnsafeGitRefError)
  })

  it('does NOT write the attacker-chosen file (arbitrary-file-write PoC)', () => {
    const pwned = join(repoDir, 'pwned.txt')
    expect(() => runGit('log', ['-1', '--format=%ct'], [`--output=${pwned}`], { cwd: repoDir }))
      .toThrow(UnsafeGitRefError)
    expect(existsSync(pwned)).toBe(false)
  })

  it('resolves a legitimate ref through the --end-of-options separator', () => {
    const out = runGit('log', ['-1', '--format=%ct'], ['HEAD'], { cwd: repoDir }).trim()
    expect(parseInt(out, 10)).toBeGreaterThan(0)
  })

  it('rejects other shell-metacharacter refs (defense in depth)', () => {
    expect(() => runGit('log', ['-1', '--format=%ct'], ['HEAD; rm -rf /'], { cwd: repoDir }))
      .toThrow(UnsafeGitRefError)
    expect(() => runGit('log', ['-1', '--format=%ct'], ['$(touch x)'], { cwd: repoDir }))
      .toThrow(UnsafeGitRefError)
  })
})

describe('resolveRefToTimestamp (semantic_bisect / triage sink)', () => {
  it('throws on a --output= injection ref rather than shelling out', () => {
    const pwned = join(repoDir, 'pwned-bisect.txt')
    expect(() => resolveRefToTimestamp(`--output=${pwned}`, repoDir)).toThrow(/Unsafe git ref/)
    expect(existsSync(pwned)).toBe(false)
  })

  it('throws on a bare leading-dash ref', () => {
    expect(() => resolveRefToTimestamp('--all', repoDir)).toThrow(/Unsafe git ref/)
  })

  it('still resolves a valid commit ref', () => {
    const ts = resolveRefToTimestamp('HEAD', repoDir)
    expect(ts).toBeGreaterThan(0)
  })

  it('still resolves an ISO date string (no git call)', () => {
    const ts = resolveRefToTimestamp('2024-01-15', repoDir)
    expect(ts).toBe(Math.floor(new Date('2024-01-15').getTime() / 1000))
  })
})
