import { describe, it, expect } from 'vitest'
import { buildCommitUrl, extractAlerts } from '../src/core/search/evolution.js'

describe('evolution alerts', () => {
  it('builds commit urls for common hosts', () => {
    const gh = buildCommitUrl('abc123', 'https://github.com/org/repo.git')
    expect(gh).toBe('https://github.com/org/repo/commit/abc123')
    const gh2 = buildCommitUrl('abc123', 'git@github.com:org/repo.git')
    expect(gh2).toBe('https://github.com/org/repo/commit/abc123')
    const gl = buildCommitUrl('deadbeef', 'https://gitlab.com/org/repo.git')
    expect(gl).toBe('https://gitlab.com/org/repo/-/commit/deadbeef')
    const bb = buildCommitUrl('fff', 'https://bitbucket.org/org/repo.git')
    expect(bb).toBe('https://bitbucket.org/org/repo/commits/fff')
  })

  it('extracts alerts from timeline', () => {
    const timeline = [
      { blobHash: 'a', commitHash: 'c1', timestamp: 1, distFromPrev: 0.1, distFromOrigin: 0.1 },
      { blobHash: 'b', commitHash: 'c2', timestamp: 2, distFromPrev: 0.5, distFromOrigin: 0.5 },
      { blobHash: 'c', commitHash: 'c3', timestamp: 3, distFromPrev: 0.9, distFromOrigin: 0.9 },
    ]
    const alerts = extractAlerts(timeline as any, 0.4, 2)
    expect(alerts.length).toBe(2)
    expect(alerts[0].distFromPrev).toBeGreaterThanOrEqual(0.5)
  })
})
