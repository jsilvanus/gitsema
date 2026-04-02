import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  compareClusterSnapshots,
  resolveRefToTimestamp,
  type ClusterSnapshot,
  type ClusterInfo,
  type ClusterReport,
} from '../src/core/search/clustering.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCluster(id: number, label: string, centroid: number[], size: number): ClusterInfo {
  return { id, label, centroid, size, representativePaths: [], topKeywords: [], enhancedKeywords: [] }
}

function makeReport(clusters: ClusterInfo[]): ClusterReport {
  return { clusters, edges: [], totalBlobs: clusters.reduce((s, c) => s + c.size, 0), k: clusters.length, clusteredAt: 0 }
}

function makeSnapshot(clusters: ClusterInfo[], blobToCluster: Record<string, number>): ClusterSnapshot {
  return { report: makeReport(clusters), assignments: new Map(Object.entries(blobToCluster)) }
}

// ---------------------------------------------------------------------------
// compareClusterSnapshots
// ---------------------------------------------------------------------------

describe('compareClusterSnapshots', () => {
  it('counts stable blobs when assignments are unchanged', () => {
    const clusterA = makeCluster(0, 'src/auth', [1, 0], 3)
    const clusterB = makeCluster(1, 'src/db', [0, 1], 2)

    const snap1 = makeSnapshot([clusterA, clusterB], {
      'blob1': 0, 'blob2': 0, 'blob3': 0,
      'blob4': 1, 'blob5': 1,
    })
    const snap2 = makeSnapshot([clusterA, clusterB], {
      'blob1': 0, 'blob2': 0, 'blob3': 0,
      'blob4': 1, 'blob5': 1,
    })

    const report = compareClusterSnapshots(snap1, snap2, 'HEAD~5', 'HEAD')

    expect(report.ref1).toBe('HEAD~5')
    expect(report.ref2).toBe('HEAD')
    expect(report.stableBlobsTotal).toBe(5)
    expect(report.newBlobsTotal).toBe(0)
    expect(report.removedBlobsTotal).toBe(0)
    expect(report.movedBlobsTotal).toBe(0)
  })

  it('counts new blobs that only appear in the after snapshot', () => {
    const cluster = makeCluster(0, 'src/auth', [1, 0], 3)

    const snap1 = makeSnapshot([cluster], { 'blob1': 0, 'blob2': 0 })
    const snap2 = makeSnapshot([cluster], { 'blob1': 0, 'blob2': 0, 'blob3': 0 })

    const report = compareClusterSnapshots(snap1, snap2, 'v1.0', 'v2.0')

    expect(report.newBlobsTotal).toBe(1)
    expect(report.stableBlobsTotal).toBe(2)
    expect(report.removedBlobsTotal).toBe(0)
    expect(report.movedBlobsTotal).toBe(0)
  })

  it('counts removed blobs that only appear in the before snapshot', () => {
    const cluster = makeCluster(0, 'src/auth', [1, 0], 2)

    const snap1 = makeSnapshot([cluster], { 'blob1': 0, 'blob2': 0, 'deleted': 0 })
    const snap2 = makeSnapshot([cluster], { 'blob1': 0, 'blob2': 0 })

    const report = compareClusterSnapshots(snap1, snap2, 'v1.0', 'v2.0')

    expect(report.removedBlobsTotal).toBe(1)
    expect(report.stableBlobsTotal).toBe(2)
    expect(report.newBlobsTotal).toBe(0)
  })

  it('tracks moved blobs as inflows/outflows', () => {
    // Two clusters: auth and db. blob3 moves from auth (before) to db (after)
    const authBefore = makeCluster(0, 'src/auth', [1, 0], 3)
    const dbBefore   = makeCluster(1, 'src/db',   [0, 1], 2)
    const authAfter  = makeCluster(0, 'src/auth',  [1, 0], 2)
    const dbAfter    = makeCluster(1, 'src/db',    [0, 1], 3)

    const snap1 = makeSnapshot([authBefore, dbBefore], {
      'blob1': 0, 'blob2': 0, 'blob3': 0,   // blob3 in auth
      'blob4': 1, 'blob5': 1,
    })
    const snap2 = makeSnapshot([authAfter, dbAfter], {
      'blob1': 0, 'blob2': 0,                // blob3 left auth
      'blob3': 1, 'blob4': 1, 'blob5': 1,   // blob3 now in db
    })

    const report = compareClusterSnapshots(snap1, snap2, 'a', 'b')

    expect(report.movedBlobsTotal).toBe(1)
    expect(report.stableBlobsTotal).toBe(4)

    // The after-db cluster should record an inflow from auth
    const dbChange = report.changes.find((c) => c.afterCluster?.label === 'src/db')
    expect(dbChange).toBeDefined()
    expect(dbChange!.inflows.length).toBeGreaterThan(0)
    expect(dbChange!.inflows[0].fromClusterLabel).toBe('src/auth')
    expect(dbChange!.inflows[0].count).toBe(1)
  })

  it('reports centroid drift correctly', () => {
    // Identical centroids → drift ≈ 0
    const before = makeCluster(0, 'a', [1, 0], 1)
    const after  = makeCluster(0, 'a', [1, 0], 1)

    const snap1 = makeSnapshot([before], { 'b1': 0 })
    const snap2 = makeSnapshot([after],  { 'b1': 0 })

    const report = compareClusterSnapshots(snap1, snap2, 'r1', 'r2')
    const change = report.changes.find((c) => c.afterCluster !== null)!
    // cosineSim([1,0],[1,0]) = 1 → drift = 1 - 1 = 0
    expect(change.centroidDrift).toBeCloseTo(0, 5)
  })

  it('handles empty before snapshot', () => {
    const cluster = makeCluster(0, 'src/new', [1, 0], 2)
    const snap1 = makeSnapshot([], {})
    const snap2 = makeSnapshot([cluster], { 'b1': 0, 'b2': 0 })

    const report = compareClusterSnapshots(snap1, snap2, 'r1', 'r2')

    expect(report.newBlobsTotal).toBe(2)
    expect(report.stableBlobsTotal).toBe(0)
    // The after-cluster has no before-match
    const change = report.changes[0]
    expect(change.beforeCluster).toBeNull()
    expect(change.afterCluster?.label).toBe('src/new')
    expect(change.centroidDrift).toBe(-1)
  })

  it('handles empty after snapshot', () => {
    const cluster = makeCluster(0, 'src/old', [1, 0], 2)
    const snap1 = makeSnapshot([cluster], { 'b1': 0, 'b2': 0 })
    const snap2 = makeSnapshot([], {})

    const report = compareClusterSnapshots(snap1, snap2, 'r1', 'r2')

    expect(report.removedBlobsTotal).toBe(2)
    expect(report.stableBlobsTotal).toBe(0)
    // Dissolved cluster: afterCluster is null
    const change = report.changes[0]
    expect(change.afterCluster).toBeNull()
    expect(change.beforeCluster?.label).toBe('src/old')
  })
})

// ---------------------------------------------------------------------------
// resolveRefToTimestamp
// ---------------------------------------------------------------------------

describe('resolveRefToTimestamp', () => {
  it('parses ISO 8601 date strings', () => {
    const ts = resolveRefToTimestamp('2024-01-15')
    expect(ts).toBe(Math.floor(new Date('2024-01-15').getTime() / 1000))
  })

  it('parses datetime strings', () => {
    const ts = resolveRefToTimestamp('2024-06-01T12:00:00Z')
    expect(ts).toBe(Math.floor(new Date('2024-06-01T12:00:00Z').getTime() / 1000))
  })

  it('throws for invalid refs that are not dates and cannot be resolved by git', () => {
    // 'notadate' is not a valid date and git is unlikely to resolve it in the test env
    expect(() => resolveRefToTimestamp('notadate_xyz_123')).toThrow()
  })
})
