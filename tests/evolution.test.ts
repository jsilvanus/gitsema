import { describe, it, expect } from 'vitest'
import { buildCommitUrl } from '../src/core/search/evolution.js'
import { buildAlerts } from '../src/cli/commands/evolution.js'
import type { EvolutionEntry } from '../src/core/search/evolution.js'

// ---------------------------------------------------------------------------
// buildCommitUrl
// ---------------------------------------------------------------------------

describe('buildCommitUrl', () => {
  it('constructs a GitHub HTTPS commit URL', () => {
    const url = buildCommitUrl('abc1234', 'https://github.com/org/repo.git')
    expect(url).toBe('https://github.com/org/repo/commit/abc1234')
  })

  it('constructs a GitHub SSH commit URL', () => {
    const url = buildCommitUrl('abc1234', 'git@github.com:org/repo.git')
    expect(url).toBe('https://github.com/org/repo/commit/abc1234')
  })

  it('constructs a GitHub HTTPS commit URL without .git suffix', () => {
    const url = buildCommitUrl('abc1234', 'https://github.com/org/repo')
    expect(url).toBe('https://github.com/org/repo/commit/abc1234')
  })

  it('constructs a GitLab HTTPS commit URL', () => {
    const url = buildCommitUrl('def5678', 'https://gitlab.com/org/repo.git')
    expect(url).toBe('https://gitlab.com/org/repo/-/commit/def5678')
  })

  it('constructs a GitLab SSH commit URL', () => {
    const url = buildCommitUrl('def5678', 'git@gitlab.com:org/repo.git')
    expect(url).toBe('https://gitlab.com/org/repo/-/commit/def5678')
  })

  it('constructs a Bitbucket HTTPS commit URL', () => {
    const url = buildCommitUrl('ghi9012', 'https://bitbucket.org/org/repo.git')
    expect(url).toBe('https://bitbucket.org/org/repo/commits/ghi9012')
  })

  it('constructs a Bitbucket SSH commit URL', () => {
    const url = buildCommitUrl('ghi9012', 'git@bitbucket.org:org/repo.git')
    expect(url).toBe('https://bitbucket.org/org/repo/commits/ghi9012')
  })

  it('returns undefined for an unrecognised remote URL', () => {
    const url = buildCommitUrl('abc1234', 'https://mygitserver.example.com/org/repo.git')
    expect(url).toBeUndefined()
  })

  it('is not fooled by a path segment that looks like a known hostname', () => {
    // An attacker could craft a URL whose path looks like github.com — must not match
    const url = buildCommitUrl('abc1234', 'https://evil.example.com/github.com/steal')
    expect(url).toBeUndefined()
  })

  it('handles SSH remote without .git suffix', () => {
    const url = buildCommitUrl('abc1234', 'git@github.com:org/repo')
    expect(url).toBe('https://github.com/org/repo/commit/abc1234')
  })

  it('handles SSH remote with a multi-segment path', () => {
    const url = buildCommitUrl('abc1234', 'git@github.com:org/team/repo.git')
    expect(url).toBe('https://github.com/org/team/repo/commit/abc1234')
  })
})

// ---------------------------------------------------------------------------
// buildAlerts
// ---------------------------------------------------------------------------

function makeEntry(distFromPrev: number, distFromOrigin = 0, index = 0): EvolutionEntry {
  return {
    blobHash: `blob${index}`,
    commitHash: `commit${index}`,
    timestamp: 1_700_000_000 + index * 86_400,
    distFromPrev,
    distFromOrigin,
  }
}

describe('buildAlerts', () => {
  const threshold = 0.3

  it('returns empty array when all entries are below threshold', () => {
    const entries = [
      makeEntry(0, 0, 0),   // origin
      makeEntry(0.1, 0.1, 1),
      makeEntry(0.2, 0.2, 2),
    ]
    const alerts = buildAlerts(entries, threshold, 5)
    expect(alerts).toHaveLength(0)
  })

  it('excludes the first entry (origin) even if distFromPrev >= threshold', () => {
    const entries = [
      makeEntry(0.5, 0, 0),  // origin – must always be excluded
      makeEntry(0.4, 0.4, 1),
    ]
    const alerts = buildAlerts(entries, threshold, 5)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].index).toBe(1)
  })

  it('returns candidates sorted by distFromPrev descending', () => {
    const entries = [
      makeEntry(0, 0, 0),
      makeEntry(0.4, 0.4, 1),
      makeEntry(0.8, 0.8, 2),
      makeEntry(0.5, 0.9, 3),
    ]
    const alerts = buildAlerts(entries, threshold, 5)
    expect(alerts.map((a) => a.entry.distFromPrev)).toEqual([0.8, 0.5, 0.4])
  })

  it('limits results to topN', () => {
    const entries = [
      makeEntry(0, 0, 0),
      makeEntry(0.9, 0.9, 1),
      makeEntry(0.8, 0.8, 2),
      makeEntry(0.7, 0.7, 3),
      makeEntry(0.6, 0.6, 4),
    ]
    const alerts = buildAlerts(entries, threshold, 2)
    expect(alerts).toHaveLength(2)
    expect(alerts[0].entry.distFromPrev).toBe(0.9)
    expect(alerts[1].entry.distFromPrev).toBe(0.8)
  })

  it('returns the correct timeline index for each alert', () => {
    const entries = [
      makeEntry(0, 0, 0),
      makeEntry(0.1, 0.1, 1),
      makeEntry(0.7, 0.7, 2),
    ]
    const alerts = buildAlerts(entries, threshold, 5)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].index).toBe(2)
  })

  it('handles an empty entries array gracefully', () => {
    const alerts = buildAlerts([], threshold, 5)
    expect(alerts).toHaveLength(0)
  })

  it('handles a single-entry array (origin only) gracefully', () => {
    const entries = [makeEntry(0, 0, 0)]
    const alerts = buildAlerts(entries, threshold, 5)
    expect(alerts).toHaveLength(0)
  })
})
