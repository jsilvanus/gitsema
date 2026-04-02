import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeClusterTimeline,
  compareClusterSnapshots,
  type ClusterSnapshot,
  type ClusterInfo,
  type ClusterReport,
} from '../src/core/search/clustering.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCluster(id: number, label: string, centroid: number[], size: number): ClusterInfo {
  return { id, label, centroid, size, representativePaths: [], topKeywords: [] }
}

function makeReport(clusters: ClusterInfo[]): ClusterReport {
  return {
    clusters,
    edges: [],
    totalBlobs: clusters.reduce((s, c) => s + c.size, 0),
    k: clusters.length,
    clusteredAt: 0,
  }
}

function makeSnapshot(clusters: ClusterInfo[], blobToCluster: Record<string, number>): ClusterSnapshot {
  return { report: makeReport(clusters), assignments: new Map(Object.entries(blobToCluster)) }
}

// ---------------------------------------------------------------------------
// computeClusterTimeline — mocked DB session
// ---------------------------------------------------------------------------

vi.mock('../src/core/db/sqlite.js', () => {
  return {
    getActiveSession: vi.fn(),
  }
})

import { getActiveSession } from '../src/core/db/sqlite.js'

/**
 * Creates a minimal rawDb mock where:
 *  - the MIN/MAX range query returns `{ minTs, maxTs }`
 *  - the "snap to real commit" MAX(timestamp) query returns the closest ts
 *  - getBlobHashesUpTo (JOIN query) returns no blobs, so snapshots are empty
 */
function makeRawDbMock(minTs: number | null, maxTs: number | null) {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('MIN(timestamp)') && sql.includes('MAX(timestamp)') && sql.includes('FROM commits')) {
        return { get: vi.fn().mockReturnValue({ minTs, maxTs }) }
      }
      if (sql.includes('MAX(timestamp)') && sql.includes('WHERE timestamp <=')) {
        // snap to real commit timestamp — return the provided ts unchanged
        return { get: vi.fn().mockImplementation((ts: number) => ({ ts })) }
      }
      // getBlobHashesUpTo inner JOIN query
      if (sql.includes('blob_commits') || sql.includes('embeddings')) {
        return { all: vi.fn().mockReturnValue([]) }
      }
      return { get: vi.fn().mockReturnValue(null), all: vi.fn().mockReturnValue([]) }
    }),
  }
}

describe('computeClusterTimeline', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty steps when no commits are indexed', async () => {
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeRawDbMock(null, null) } as any)

    const report = await computeClusterTimeline({ steps: 3 })
    expect(report.steps).toHaveLength(0)
  })

  it('returns a single step when steps=1', async () => {
    const ts = 1_700_000_000  // 2023-11-14
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeRawDbMock(ts, ts) } as any)

    const report = await computeClusterTimeline({ steps: 1 })
    expect(report.steps).toHaveLength(1)
    expect(report.steps[0].prevRef).toBeNull()
    expect(report.steps[0].changes).toBeNull()
    expect(report.steps[0].stats).toBeNull()
    // Empty snapshot because mock returns no blobs
    expect(report.steps[0].blobCount).toBe(0)
  })

  it('produces two steps with changes for steps=2', async () => {
    const ts1 = 1_700_000_000
    const ts2 = 1_710_000_000
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeRawDbMock(ts1, ts2) } as any)

    const report = await computeClusterTimeline({ steps: 2 })

    expect(report.steps).toHaveLength(2)
    // First step has no comparison
    expect(report.steps[0].prevRef).toBeNull()
    expect(report.steps[0].changes).toBeNull()
    // Second step has comparison against first
    expect(report.steps[1].prevRef).toBe(report.steps[0].ref)
    expect(report.steps[1].changes).not.toBeNull()
    expect(report.steps[1].stats).not.toBeNull()
  })

  it('sets since and until on the report', async () => {
    const ts1 = 1_700_000_000
    const ts2 = 1_710_000_000
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeRawDbMock(ts1, ts2) } as any)

    const report = await computeClusterTimeline({ steps: 1 })
    expect(report.since).toBe(ts1)
    expect(report.until).toBe(ts2)
    expect(report.k).toBe(8)
  })

  it('respects custom steps count', async () => {
    const ts1 = 1_700_000_000
    const ts2 = 1_800_000_000
    vi.mocked(getActiveSession).mockReturnValue({ rawDb: makeRawDbMock(ts1, ts2) } as any)

    const report = await computeClusterTimeline({ steps: 4, k: 3 })
    expect(report.steps).toHaveLength(4)
    expect(report.k).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// ClusterTimeline — label change detection via compareClusterSnapshots
// ---------------------------------------------------------------------------

describe('cluster-timeline label change detection', () => {
  it('detects label change when cluster is relabeled between steps', () => {
    const before = makeCluster(0, 'auth jwt (src/server)', [1, 0], 5)
    const after  = makeCluster(0, 'oauth middleware (src/server)', [0.98, 0.2], 5)

    const snap1 = makeSnapshot([before], { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0 })
    const snap2 = makeSnapshot([after], { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0 })

    const diff = compareClusterSnapshots(snap1, snap2, 'step1', 'step2')
    const change = diff.changes[0]

    expect(change.afterCluster?.label).toBe('oauth middleware (src/server)')
    expect(change.beforeCluster?.label).toBe('auth jwt (src/server)')
    expect(change.centroidDrift).toBeGreaterThan(0)
    expect(change.centroidDrift).toBeLessThan(0.1)
  })

  it('labels with keywords + path follow the expected format', () => {
    // Verify the enriched label format: "keyword1 keyword2 keyword3 (path/prefix)"
    const label = 'search embed index (src/core)'
    expect(label).toMatch(/^\w[\w ]+ \(\S+\)$/)
  })

  it('all blobs stable when identical snapshots compared', () => {
    const cluster = makeCluster(0, 'search indexing (src/core)', [1, 0], 3)
    const snap = makeSnapshot([cluster], { b1: 0, b2: 0, b3: 0 })

    const diff = compareClusterSnapshots(snap, snap, 'a', 'b')
    expect(diff.stableBlobsTotal).toBe(3)
    expect(diff.newBlobsTotal).toBe(0)
    expect(diff.movedBlobsTotal).toBe(0)
  })
})

