import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeSemanticCollisions,
  meanCentroid,
  loadBlobData,
  type SemanticCollisionReport,
} from '../src/core/search/mergeAudit.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn(),
}))

// branchDiff and clustering are called by computeMergeImpact, tested separately
vi.mock('../src/core/git/branchDiff.js', () => ({
  getMergeBase: vi.fn(),
  getBranchExclusiveBlobs: vi.fn(),
}))

vi.mock('../src/core/search/clustering.js', () => ({
  computeClusterSnapshot: vi.fn(),
  compareClusterSnapshots: vi.fn(),
  getBlobHashesUpTo: vi.fn(),
  resolveRefToTimestamp: vi.fn(),
}))

import { getActiveSession } from '../src/core/db/sqlite.js'

const mockGetActiveSession = vi.mocked(getActiveSession)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec)
  return Buffer.from(f32.buffer)
}

/**
 * Builds a rawDb mock that handles calls from loadBlobData.
 * The `.all()` implementations filter results to match the placeholder args
 * actually passed, so that loadBlobData(['h1']) only sees h1's data.
 */
function makeRawDb(opts: {
  embeddings?: Array<{ blob_hash: string; vector: Buffer }>
  paths?: Array<{ blob_hash: string; path: string }>
  assignments?: Array<{ blob_hash: string; cluster_id: number }>
  clusterLabel?: string | null
}): InstanceType<import('better-sqlite3').default> {
  const emb = opts.embeddings ?? []
  const pts = opts.paths ?? []
  const asgn = opts.assignments ?? []
  const label = opts.clusterLabel ?? undefined

  return {
    prepare: vi.fn().mockImplementation((sql: string) => ({
      all: vi.fn().mockImplementation((...args: unknown[]) => {
        const argSet = new Set(args)
        if (sql.includes('FROM embeddings')) {
          return emb.filter((r) => argSet.has(r.blob_hash))
        }
        if (sql.includes('FROM paths')) {
          return pts.filter((r) => argSet.has(r.blob_hash))
        }
        if (sql.includes('FROM cluster_assignments')) {
          return asgn.filter((r) => argSet.has(r.blob_hash))
        }
        return []
      }),
      get: vi.fn().mockImplementation((_id: unknown) => {
        if (sql.includes('FROM blob_clusters')) return label ? { label } : undefined
        return undefined
      }),
    })),
  } as unknown as InstanceType<import('better-sqlite3').default>
}

function setDb(rawDb: InstanceType<import('better-sqlite3').default>): void {
  mockGetActiveSession.mockReturnValue({ rawDb } as ReturnType<typeof getActiveSession>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// meanCentroid
// ---------------------------------------------------------------------------

describe('meanCentroid', () => {
  it('returns empty array for empty input', () => {
    expect(meanCentroid([])).toEqual([])
  })

  it('returns the vector unchanged for single input', () => {
    expect(meanCentroid([[1, 2, 3]])).toEqual([1, 2, 3])
  })

  it('computes the correct mean', () => {
    const result = meanCentroid([[1, 0], [0, 1]])
    expect(result[0]).toBeCloseTo(0.5)
    expect(result[1]).toBeCloseTo(0.5)
  })

  it('handles three vectors', () => {
    const result = meanCentroid([[3, 0, 0], [0, 3, 0], [0, 0, 3]])
    expect(result).toEqual([1, 1, 1])
  })
})

// ---------------------------------------------------------------------------
// computeSemanticCollisions
// ---------------------------------------------------------------------------

describe('computeSemanticCollisions', () => {
  it('returns zero collisions and -1 centroid similarity when both sets are empty', () => {
    setDb(makeRawDb({}))
    const report = computeSemanticCollisions([], [], 'a', 'b', 'base')
    expect(report.collisionPairs).toHaveLength(0)
    expect(report.centroidSimilarity).toBe(-1)
    expect(report.blobCountA).toBe(0)
    expect(report.blobCountB).toBe(0)
  })

  it('returns -1 centroid similarity when one set is empty', () => {
    const rawDb = makeRawDb({
      embeddings: [{ blob_hash: 'h1', vector: toBuffer([1, 0]) }],
      paths: [{ blob_hash: 'h1', path: 'src/a.ts' }],
    })
    setDb(rawDb)
    const report = computeSemanticCollisions(['h1'], [], 'a', 'b', 'base')
    expect(report.centroidSimilarity).toBe(-1)
  })

  it('detects a collision when similarity is above threshold', () => {
    // blob "h1" (branch A) and blob "h2" (branch B) have identical vectors → sim = 1.0
    const rawDb = makeRawDb({
      embeddings: [
        { blob_hash: 'h1', vector: toBuffer([1, 0]) },
        { blob_hash: 'h2', vector: toBuffer([1, 0]) },
      ],
      paths: [
        { blob_hash: 'h1', path: 'src/auth.ts' },
        { blob_hash: 'h2', path: 'src/checkout.ts' },
      ],
    })
    setDb(rawDb)

    const report = computeSemanticCollisions(['h1'], ['h2'], 'branchA', 'branchB', 'mergeXYZ', {
      threshold: 0.85,
    })

    expect(report.branchA).toBe('branchA')
    expect(report.branchB).toBe('branchB')
    expect(report.mergeBase).toBe('mergeXYZ')
    expect(report.collisionPairs).toHaveLength(1)
    expect(report.collisionPairs[0].similarity).toBeCloseTo(1.0, 3)
    expect(report.collisionPairs[0].blobA.hash).toBe('h1')
    expect(report.collisionPairs[0].blobB.hash).toBe('h2')
    expect(report.collisionPairs[0].blobA.paths).toContain('src/auth.ts')
    expect(report.collisionPairs[0].blobB.paths).toContain('src/checkout.ts')
  })

  it('does not detect a collision when similarity is below threshold', () => {
    // Orthogonal vectors → cosine similarity = 0
    const rawDb = makeRawDb({
      embeddings: [
        { blob_hash: 'h1', vector: toBuffer([1, 0]) },
        { blob_hash: 'h2', vector: toBuffer([0, 1]) },
      ],
      paths: [],
    })
    setDb(rawDb)

    const report = computeSemanticCollisions(['h1'], ['h2'], 'a', 'b', 'base', {
      threshold: 0.85,
    })

    expect(report.collisionPairs).toHaveLength(0)
  })

  it('respects topK limit', () => {
    // 3 pairs all above threshold, but topK = 2
    const rawDb = makeRawDb({
      embeddings: [
        { blob_hash: 'a1', vector: toBuffer([1, 0]) },
        { blob_hash: 'a2', vector: toBuffer([1, 0]) },
        { blob_hash: 'a3', vector: toBuffer([1, 0]) },
        { blob_hash: 'b1', vector: toBuffer([1, 0]) },
      ],
      paths: [],
    })
    setDb(rawDb)

    const report = computeSemanticCollisions(
      ['a1', 'a2', 'a3'],
      ['b1'],
      'a', 'b', 'base',
      { threshold: 0.5, topK: 2 },
    )
    expect(report.collisionPairs).toHaveLength(2)
  })

  it('computes centroid similarity correctly for two orthogonal branch sets', () => {
    // Branch A centroid = [1, 0], Branch B centroid = [0, 1] → sim = 0
    const rawDb = makeRawDb({
      embeddings: [
        { blob_hash: 'a1', vector: toBuffer([1, 0]) },
        { blob_hash: 'b1', vector: toBuffer([0, 1]) },
      ],
      paths: [],
    })
    setDb(rawDb)

    const report = computeSemanticCollisions(['a1'], ['b1'], 'a', 'b', 'base', {
      threshold: 0.99, // no collision pairs, but centroid still computed
    })

    expect(report.centroidSimilarity).toBeCloseTo(0, 3)
  })

  it('groups collisions into zones when both blobs share a cluster', () => {
    // Both blobs assigned to cluster 7, which has label "auth zone"
    const rawDb = makeRawDb({
      embeddings: [
        { blob_hash: 'h1', vector: toBuffer([1, 0]) },
        { blob_hash: 'h2', vector: toBuffer([1, 0]) },
      ],
      paths: [
        { blob_hash: 'h1', path: 'src/auth.ts' },
        { blob_hash: 'h2', path: 'src/login.ts' },
      ],
      assignments: [
        { blob_hash: 'h1', cluster_id: 7 },
        { blob_hash: 'h2', cluster_id: 7 },
      ],
      clusterLabel: 'auth zone',
    })
    setDb(rawDb)

    const report = computeSemanticCollisions(['h1'], ['h2'], 'a', 'b', 'base', {
      threshold: 0.5,
    })

    expect(report.collisionPairs[0].clusterLabel).toBe('auth zone')
    expect(report.collisionZones).toHaveLength(1)
    expect(report.collisionZones[0].clusterLabel).toBe('auth zone')
    expect(report.collisionZones[0].pairCount).toBe(1)
    expect(report.collisionZones[0].topPaths).toContain('src/auth.ts')
    expect(report.collisionZones[0].topPaths).toContain('src/login.ts')
  })

  it('does not produce a zone when blobs are in different clusters', () => {
    const rawDb = makeRawDb({
      embeddings: [
        { blob_hash: 'h1', vector: toBuffer([1, 0]) },
        { blob_hash: 'h2', vector: toBuffer([1, 0]) },
      ],
      paths: [],
      assignments: [
        { blob_hash: 'h1', cluster_id: 1 },
        { blob_hash: 'h2', cluster_id: 2 },
      ],
    })
    setDb(rawDb)

    const report = computeSemanticCollisions(['h1'], ['h2'], 'a', 'b', 'base', {
      threshold: 0.5,
    })

    expect(report.collisionPairs[0].clusterLabel).toBeUndefined()
    expect(report.collisionZones).toHaveLength(0)
  })
})
