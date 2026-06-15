/**
 * Security regression tests for the narrator's git-log path.
 *
 * `fetchCommitEvents` is the only place the narrator shells out to git, and its
 * `range`/`since`/`until` inputs are reachable from `gitsema narrate --range`
 * and from the `POST /api/v1/narrate` request body. These tests verify that a
 * malicious value cannot inject shell commands or git options (review9 §2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fetchCommitEvents, isSafeGitRange } from '../src/core/narrator/narrator.js'

describe('isSafeGitRange', () => {
  it('accepts ordinary git revisions and ranges', () => {
    for (const r of ['HEAD', 'main', 'v1.2.3', 'abc1234', 'HEAD~10..HEAD', 'v1..v2', 'main...feature', 'origin/main', '@{upstream}']) {
      expect(isSafeGitRange(r), r).toBe(true)
    }
  })

  it('rejects shell metacharacters', () => {
    for (const r of ['HEAD; rm -rf /', 'HEAD$(touch x)', 'HEAD`id`', 'HEAD | cat', 'HEAD && ls', 'a b', "v1'"]) {
      expect(isSafeGitRange(r), r).toBe(false)
    }
  })

  it('rejects option injection (leading dash)', () => {
    for (const r of ['--all', '--output=/tmp/x', '-n1']) {
      expect(isSafeGitRange(r), r).toBe(false)
    }
  })
})

describe('fetchCommitEvents — injection resistance', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gitsema-narrator-sec-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'initial'], { cwd: repo })
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('does not execute a shell payload smuggled through range', () => {
    const sentinel = join(repo, 'pwned')
    const events = fetchCommitEvents({ range: `HEAD; touch ${sentinel}`, cwd: repo })
    expect(events).toEqual([])
    expect(existsSync(sentinel)).toBe(false)
  })

  it('does not honor option injection through range', () => {
    // `--all` would be a valid git log option; it must be rejected, not passed.
    const events = fetchCommitEvents({ range: '--all', cwd: repo })
    expect(events).toEqual([])
  })

  it('still returns commits for a legitimate range', () => {
    const events = fetchCommitEvents({ range: 'HEAD', cwd: repo })
    expect(events.length).toBe(1)
    expect(events[0].subject).toBe('initial')
  })

  it('treats since/until with spaces as a single argument (no injection)', () => {
    // "2 weeks ago" has spaces; with execFile (no shell) this is one argv element.
    const events = fetchCommitEvents({ since: '2 weeks ago', cwd: repo })
    expect(Array.isArray(events)).toBe(true)
  })
})
