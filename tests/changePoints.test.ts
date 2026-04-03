import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeConceptChangePoints,
  computeFileChangePoints,
  type ConceptChangePointReport,
  type FileChangePointReport,
} from '../src/core/search/changePoints.js'
import {
  computeClusterChangePoints,
  type ClusterChangePointReport,
} from '../src/core/search/clustering.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn(),
}))

vi.mock('../src/core/search/evolution.js', () => ({
  computeEvolution: vi.fn(),
}))

import { getActiveSession } from '../src/core/db/sqlite.js'
import { computeEvolution } from '../src/core/search/evolution.js'

// Deterministic 2-D embedding vectors (unit-length for cleaner cosine math)
const emb = {
  a: [1, 0],
  b: [0, 1],
  c: [Math.SQRT1_2, Math.SQRT1_2],
}

// Cosine distance between emb.a and emb.b should be 1.0 (orthogonal)
// Cosine distance between emb.a and emb.c ≈ 0.293

function toBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec)
  return Buffer.from(f32.buffer)
}

// ---------------------------------------------------------------------------
// computeConceptChangePoints
// ---------------------------------------------------------------------------

/**
 * Creates a minimal rawDb mock for computeConceptChangePoints.
 *
 * Two blobs (hash "a" and "b") are pre-loaded:
 *   - blob "a" has embedding [1,0], first seen at ts=100 in commit "c1"
 *   - blob "b" has embedding [0,1], first seen at ts=200 in commit "c2"
 *
 * Two commits are indexed:
 *   - commit "c1" at ts=100
 *   - commit "c2" at ts=200
 *
 * Query embedding [1,0] → blob "a" scores 1.0, blob "b" scores 0.0.
 * At commit c1: visible blobs = {a}   → centroid = [1,0]
 * At commit c2: visible blobs = {a,b} → top-1 centroid = [1,0]  (still "a" dominates with score 1.0)
 * If top-2: centroid = weighted([1,0], [0,1], weights=[1.0, 0.0]) = [1,0] (b weight is ~0, no shift)
 *
 * To force a change point, we use a query embedding [0.5, 0.5] so both blobs score ~0.7:
 * At c1: centroid of top-1 = emb[a] = [1,0]
 * At c2: centroid of top-1 = still [1,0] (same blob)
 * For a change, we need the top-k blob to change — use topK=1, so:
 *   - At c1: only blob "a" visible → centroid = [1,0]
 *   - At c2: both visible, top-1 by score: "a" scores sim([0.5,0.5],[1,0]) ≈ 0.707,
 *             "b" scores sim([0.5,0.5],[0,1]) ≈ 0.707 → tie, so "a" likely wins (order stable)
 *
 * Actually to get a real shift, let's have 3 blobs: a=[1,0] first seen c1, b=[0,1] first seen c2.
 * Query = [0,1] → a scores 0, b scores 1. topK=1.
 * At c1: only a visible. top-1 = a. centroid = [1,0].
 * At c2: a and b visible. top-1 = b (score 1). centroid = [0,1].
 * Distance = cosineDistance([1,0],[0,1]) = 1.0 → change point!
 */
function makeConceptDbMock() {
  const embRowsResult = [
    { blob_hash: 'aaaa', vector: toBuffer([1, 0]) },
    { blob_hash: 'bbbb', vector: toBuffer([0, 1]) },
  ]

  // First-seen query (MIN + JOIN): blob "aaaa" at ts=100, "bbbb" at ts=200
  const firstSeenResult = [
    { blob_hash: 'aaaa', min_ts: 100, commit_hash: 'c1' },
    { blob_hash: 'bbbb', min_ts: 200, commit_hash: 'c2' },
  ]

  // Paths
  const pathResult = [
    { blob_hash: 'aaaa', path: 'src/a.ts' },
    { blob_hash: 'bbbb', path: 'src/b.ts' },
  ]

  // Commits ordered by timestamp
  const commitResult = [
    { commit_hash: 'c1', timestamp: 100 },
    { commit_hash: 'c2', timestamp: 200 },
  ]

  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM embeddings') && !sql.includes('WHERE')) {
        return { all: vi.fn().mockReturnValue(embRowsResult) }
      }
      if (sql.includes('MIN(c.timestamp)') && sql.includes('blob_commits')) {
        return { all: vi.fn().mockReturnValue(firstSeenResult) }
      }
      if (sql.includes('FROM paths')) {
        return { all: vi.fn().mockReturnValue(pathResult) }
      }
      if (sql.includes('FROM commits') && sql.includes('ORDER BY timestamp ASC')) {
        return { all: vi.fn().mockReturnValue(commitResult) }
      }
      return { all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) }
    }),
  }
}

describe('computeConceptChangePoints', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns empty points when no embeddings exist', () => {
    vi.mocked(getActiveSession).mockReturnValue({
      rawDb: {
        prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
      },
    } as any)

    const report = computeConceptChangePoints('test', [1, 0])
    expect(report.type).toBe('concept-change-points')
    expect(report.points).toHaveLength(0)
  })

  it('detects a change point when concept centroid shifts above threshold', () => {
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeConceptDbMock() } as any)

    // Query = [0, 1] → blob "aaaa" scores ~0, blob "bbbb" scores ~1
    // topK=1, threshold=0.3:
    //   commit c1 (ts=100): only "aaaa" visible → centroid=[1,0]
    //   commit c2 (ts=200): "aaaa"(score≈0) and "bbbb"(score=1) visible → top-1="bbbb" → centroid=[0,1]
    //   distance = cosineDistance([1,0],[0,1]) = 1.0 >= 0.3 → change point
    const report = computeConceptChangePoints('auth', [0, 1], { topK: 1, threshold: 0.3, topPoints: 5 })

    expect(report.type).toBe('concept-change-points')
    expect(report.query).toBe('auth')
    expect(report.k).toBe(1)
    expect(report.threshold).toBe(0.3)
    expect(report.points.length).toBeGreaterThanOrEqual(1)
    expect(report.points[0].distance).toBeCloseTo(1.0, 3)
    expect(report.points[0].before.commit).toBe('c1')
    expect(report.points[0].after.commit).toBe('c2')
  })

  it('sorts change points by distance descending', () => {
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeConceptDbMock() } as any)

    const report = computeConceptChangePoints('auth', [0, 1], { topK: 1, threshold: 0.0, topPoints: 10 })
    const distances = report.points.map((p) => p.distance)
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i - 1])
    }
  })

  it('respects topPoints limit', () => {
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeConceptDbMock() } as any)

    const report = computeConceptChangePoints('auth', [0, 1], { topK: 1, threshold: 0.0, topPoints: 1 })
    expect(report.points.length).toBeLessThanOrEqual(1)
  })

  it('returns correct report metadata', () => {
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeConceptDbMock() } as any)

    const report = computeConceptChangePoints('myquery', [1, 0], {
      topK: 50,
      threshold: 0.5,
      since: 50,
      until: 300,
    })
    expect(report.query).toBe('myquery')
    expect(report.threshold).toBe(0.5)
    expect(report.range.since).toBe('1970-01-01')
    expect(report.range.until).toBe('1970-01-01')
  })
})

// ---------------------------------------------------------------------------
// computeFileChangePoints
// ---------------------------------------------------------------------------

function makeEvolutionEntry(
  blobHash: string,
  commitHash: string,
  timestamp: number,
  distFromPrev: number,
): { blobHash: string; commitHash: string; timestamp: number; distFromPrev: number; distFromOrigin: number } {
  return { blobHash, commitHash, timestamp, distFromPrev, distFromOrigin: distFromPrev }
}

describe('computeFileChangePoints', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns empty points when no evolution history exists', () => {
    vi.mocked(computeEvolution).mockReturnValue([])

    const report = computeFileChangePoints('src/auth.ts')
    expect(report.type).toBe('file-change-points')
    expect(report.path).toBe('src/auth.ts')
    expect(report.points).toHaveLength(0)
  })

  it('detects change points above threshold', () => {
    vi.mocked(computeEvolution).mockReturnValue([
      makeEvolutionEntry('blob0', 'c0', 1000, 0),         // origin
      makeEvolutionEntry('blob1', 'c1', 2000, 0.2),       // below threshold
      makeEvolutionEntry('blob2', 'c2', 3000, 0.5),       // above threshold → change point
      makeEvolutionEntry('blob3', 'c3', 4000, 0.1),       // below threshold
    ])

    const report = computeFileChangePoints('src/auth.ts', { threshold: 0.3 })
    expect(report.points).toHaveLength(1)
    expect(report.points[0].distance).toBeCloseTo(0.5, 5)
    expect(report.points[0].before.commit).toBe('c1')
    expect(report.points[0].after.commit).toBe('c2')
  })

  it('excludes the origin entry even if distFromPrev is set', () => {
    // origin entry (index 0) always has distFromPrev=0 and should never be a "before" boundary
    vi.mocked(computeEvolution).mockReturnValue([
      makeEvolutionEntry('blob0', 'c0', 1000, 0.9),  // origin — must be excluded as "after"
      makeEvolutionEntry('blob1', 'c1', 2000, 0.5),  // this IS above threshold → change point
    ])

    const report = computeFileChangePoints('src/auth.ts', { threshold: 0.3 })
    expect(report.points).toHaveLength(1)
    expect(report.points[0].after.commit).toBe('c1')
  })

  it('sorts change points by distance descending', () => {
    vi.mocked(computeEvolution).mockReturnValue([
      makeEvolutionEntry('b0', 'c0', 1000, 0),
      makeEvolutionEntry('b1', 'c1', 2000, 0.4),
      makeEvolutionEntry('b2', 'c2', 3000, 0.8),
      makeEvolutionEntry('b3', 'c3', 4000, 0.6),
    ])

    const report = computeFileChangePoints('src/auth.ts', { threshold: 0.3 })
    expect(report.points.map((p) => p.distance)).toEqual([0.8, 0.6, 0.4])
  })

  it('respects topPoints limit', () => {
    vi.mocked(computeEvolution).mockReturnValue([
      makeEvolutionEntry('b0', 'c0', 1000, 0),
      makeEvolutionEntry('b1', 'c1', 2000, 0.9),
      makeEvolutionEntry('b2', 'c2', 3000, 0.8),
      makeEvolutionEntry('b3', 'c3', 4000, 0.7),
    ])

    const report = computeFileChangePoints('src/auth.ts', { threshold: 0.3, topPoints: 2 })
    expect(report.points).toHaveLength(2)
    expect(report.points[0].distance).toBe(0.9)
  })

  it('filters by since/until on the "after" entry', () => {
    vi.mocked(computeEvolution).mockReturnValue([
      makeEvolutionEntry('b0', 'c0', 1000, 0),
      makeEvolutionEntry('b1', 'c1', 2000, 0.7),  // after.timestamp=2000 — within [1500,2500]
      makeEvolutionEntry('b2', 'c2', 3000, 0.6),  // after.timestamp=3000 — outside range
    ])

    const report = computeFileChangePoints('src/auth.ts', {
      threshold: 0.3,
      since: 1500,
      until: 2500,
    })
    expect(report.points).toHaveLength(1)
    expect(report.points[0].after.commit).toBe('c1')
  })

  it('returns correct metadata', () => {
    vi.mocked(computeEvolution).mockReturnValue([])

    const report = computeFileChangePoints('src/foo.ts', {
      threshold: 0.4,
      topPoints: 3,
      since: 1000,
      until: 9000,
    })
    expect(report.path).toBe('src/foo.ts')
    expect(report.threshold).toBe(0.4)
    expect(report.range.since).not.toBeNull()
    expect(report.range.until).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// computeClusterChangePoints
// ---------------------------------------------------------------------------

function makeClusterChangePointDbMock(minTs: number | null, maxTs: number | null) {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('MIN(timestamp)') && sql.includes('MAX(timestamp)') && sql.includes('FROM commits')) {
        return { get: vi.fn().mockReturnValue({ minTs, maxTs }) }
      }
      if (sql.includes('DISTINCT timestamp') && sql.includes('FROM commits')) {
        if (minTs === null) return { all: vi.fn().mockReturnValue([]) }
        const ts = minTs === maxTs ? [{ timestamp: minTs }] : [{ timestamp: minTs }, { timestamp: maxTs }]
        return { all: vi.fn().mockReturnValue(ts) }
      }
      // getBlobHashesUpTo inner JOIN — return empty set (no blobs → empty snapshots)
      if (sql.includes('blob_commits') || sql.includes('embeddings')) {
        return { all: vi.fn().mockReturnValue([]) }
      }
      return { get: vi.fn().mockReturnValue(null), all: vi.fn().mockReturnValue([]) }
    }),
  }
}

describe('computeClusterChangePoints', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns empty points when no commits are indexed', async () => {
    vi.mocked(getActiveSession).mockReturnValue({
      rawDb: makeClusterChangePointDbMock(null, null),
    } as any)

    const report = await computeClusterChangePoints({ k: 4 })
    expect(report.type).toBe('cluster-change-points')
    expect(report.points).toHaveLength(0)
    expect(report.range.since).toBe('')
    expect(report.range.until).toBe('')
  })

  it('returns empty points when fewer than 2 distinct timestamps exist', async () => {
    const ts = 1_700_000_000
    vi.mocked(getActiveSession).mockReturnValue({
      rawDb: makeClusterChangePointDbMock(ts, ts),
    } as any)

    const report = await computeClusterChangePoints({ k: 4 })
    expect(report.points).toHaveLength(0)
  })

  it('returns correct metadata on two timestamps (empty blob sets → no shift)', async () => {
    const ts1 = 1_700_000_000
    const ts2 = 1_710_000_000
    vi.mocked(getActiveSession).mockReturnValue({
      rawDb: makeClusterChangePointDbMock(ts1, ts2),
      db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }) }) },
    } as any)

    const report = await computeClusterChangePoints({ k: 4, threshold: 0.3, topPoints: 5 })

    expect(report.type).toBe('cluster-change-points')
    expect(report.k).toBe(4)
    expect(report.threshold).toBe(0.3)
    // With empty blob sets, no clusters → no change points
    expect(report.points).toHaveLength(0)
    expect(report.range.since).toBeTruthy()
    expect(report.range.until).toBeTruthy()
  })

  it('respects maxCommits sampling', async () => {
    // Build 10 distinct timestamps
    const base = 1_700_000_000
    const timestamps = Array.from({ length: 10 }, (_, i) => ({ timestamp: base + i * 1000 }))

    const rawDbMock = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('MIN(timestamp)') && sql.includes('FROM commits')) {
          return { get: vi.fn().mockReturnValue({ minTs: base, maxTs: base + 9000 }) }
        }
        if (sql.includes('DISTINCT timestamp')) {
          return { all: vi.fn().mockReturnValue(timestamps) }
        }
        return { all: vi.fn().mockReturnValue([]) }
      }),
    }
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: rawDbMock, db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }) }) } } as any)

    // With maxCommits=3, only 3 timestamps are sampled
    const report = await computeClusterChangePoints({ maxCommits: 3, threshold: 0.3 })
    expect(report.type).toBe('cluster-change-points')
    // No blobs → no change points, but at least confirm it ran without error
    expect(report.points).toHaveLength(0)
  })
})
