import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeBranchSummary } from '../src/core/search/branchSummary.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn(),
}))

vi.mock('../src/core/git/branchDiff.js', () => ({
  getMergeBase: vi.fn(),
  getBranchExclusiveBlobs: vi.fn(),
}))

vi.mock('../src/core/search/evolution.js', () => ({
  computeEvolution: vi.fn(),
}))

import { getActiveSession } from '../src/core/db/sqlite.js'
import { getMergeBase, getBranchExclusiveBlobs } from '../src/core/git/branchDiff.js'
import { computeEvolution } from '../src/core/search/evolution.js'

const mockGetActiveSession = vi.mocked(getActiveSession)
const mockGetMergeBase = vi.mocked(getMergeBase)
const mockGetBranchExclusiveBlobs = vi.mocked(getBranchExclusiveBlobs)
const mockComputeEvolution = vi.mocked(computeEvolution)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec)
  return Buffer.from(f32.buffer)
}

const FAKE_MERGE_BASE = 'a'.repeat(40)

function makeRawDb(opts: {
  embeddings?: Array<{ blob_hash: string; vector: Buffer }>
  paths?: Array<{ blob_hash: string; path: string }>
  clusters?: Array<{
    id: number
    label: string
    centroid: Buffer
    top_keywords: string
    representative_paths: string
  }>
}): InstanceType<import('better-sqlite3').default> {
  const emb = opts.embeddings ?? []
  const pts = opts.paths ?? []
  const cls = opts.clusters ?? []

  return {
    prepare: vi.fn().mockImplementation((sql: string) => ({
      all: vi.fn().mockImplementation(() => {
        if (sql.includes('FROM embeddings')) return emb
        if (sql.includes('FROM paths')) return pts
        if (sql.includes('FROM blob_clusters')) return cls
        return []
      }),
    })),
  } as unknown as InstanceType<import('better-sqlite3').default>
}

function setDb(rawDb: InstanceType<import('better-sqlite3').default>): void {
  mockGetActiveSession.mockReturnValue({ rawDb } as ReturnType<typeof getActiveSession>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetMergeBase.mockReturnValue(FAKE_MERGE_BASE)
  mockComputeEvolution.mockReturnValue([])
})

// ---------------------------------------------------------------------------
// computeBranchSummary
// ---------------------------------------------------------------------------

describe('computeBranchSummary', () => {
  it('returns empty summary when branch has no exclusive blobs', async () => {
    mockGetBranchExclusiveBlobs.mockReturnValue([])
    setDb(makeRawDb({}))

    const result = await computeBranchSummary('feature/foo', 'main')

    expect(result.branch).toBe('feature/foo')
    expect(result.baseBranch).toBe('main')
    expect(result.mergeBase).toBe(FAKE_MERGE_BASE)
    expect(result.exclusiveBlobCount).toBe(0)
    expect(result.branchCentroid).toEqual([])
    expect(result.nearestConcepts).toEqual([])
    expect(result.topChangedPaths).toEqual([])
  })

  it('computes branch centroid from exclusive blob embeddings', async () => {
    mockGetBranchExclusiveBlobs.mockReturnValue(['h1', 'h2'])
    const rawDb = makeRawDb({
      embeddings: [
        { blob_hash: 'h1', vector: toBuffer([1, 0]) },
        { blob_hash: 'h2', vector: toBuffer([0, 1]) },
      ],
      paths: [],
      clusters: [],
    })
    setDb(rawDb)

    const result = await computeBranchSummary('feature/foo', 'main')

    expect(result.exclusiveBlobCount).toBe(2)
    expect(result.branchCentroid).toHaveLength(2)
    expect(result.branchCentroid[0]).toBeCloseTo(0.5)
    expect(result.branchCentroid[1]).toBeCloseTo(0.5)
  })

  it('matches branch centroid to existing concept clusters', async () => {
    mockGetBranchExclusiveBlobs.mockReturnValue(['h1'])
    const branchVec = [1, 0]
    const cluster1Vec = [1, 0]   // sim = 1.0
    const cluster2Vec = [0, 1]   // sim = 0.0

    const rawDb = makeRawDb({
      embeddings: [{ blob_hash: 'h1', vector: toBuffer(branchVec) }],
      paths: [{ blob_hash: 'h1', path: 'src/auth.ts' }],
      clusters: [
        {
          id: 1,
          label: 'auth cluster',
          centroid: toBuffer(cluster1Vec),
          top_keywords: '["auth","token"]',
          representative_paths: '["src/auth/jwt.ts"]',
        },
        {
          id: 2,
          label: 'db cluster',
          centroid: toBuffer(cluster2Vec),
          top_keywords: '["db","query"]',
          representative_paths: '["src/db/index.ts"]',
        },
      ],
    })
    setDb(rawDb)

    const result = await computeBranchSummary('feature/foo', 'main', { topConcepts: 2 })

    expect(result.nearestConcepts).toHaveLength(2)
    expect(result.nearestConcepts[0].clusterLabel).toBe('auth cluster')
    expect(result.nearestConcepts[0].similarity).toBeCloseTo(1.0, 3)
    expect(result.nearestConcepts[1].clusterLabel).toBe('db cluster')
    expect(result.nearestConcepts[1].similarity).toBeCloseTo(0.0, 3)
  })

  it('limits nearestConcepts to topConcepts', async () => {
    mockGetBranchExclusiveBlobs.mockReturnValue(['h1'])
    const rawDb = makeRawDb({
      embeddings: [{ blob_hash: 'h1', vector: toBuffer([1, 0]) }],
      paths: [],
      clusters: [
        { id: 1, label: 'c1', centroid: toBuffer([1, 0]), top_keywords: '[]', representative_paths: '[]' },
        { id: 2, label: 'c2', centroid: toBuffer([0.9, 0.1]), top_keywords: '[]', representative_paths: '[]' },
        { id: 3, label: 'c3', centroid: toBuffer([0.8, 0.2]), top_keywords: '[]', representative_paths: '[]' },
      ],
    })
    setDb(rawDb)

    const result = await computeBranchSummary('feature/foo', 'main', { topConcepts: 2 })

    expect(result.nearestConcepts).toHaveLength(2)
  })

  it('reports semantic drift for files with evolution entries', async () => {
    mockGetBranchExclusiveBlobs.mockReturnValue(['h1'])
    const rawDb = makeRawDb({
      embeddings: [{ blob_hash: 'h1', vector: toBuffer([1, 0]) }],
      paths: [{ blob_hash: 'h1', path: 'src/auth.ts' }],
      clusters: [],
    })
    setDb(rawDb)

    // Simulate two evolution entries: drift of 0.42 at last step
    mockComputeEvolution.mockReturnValue([
      { blobHash: 'old', commitHash: 'c1', timestamp: 100, distFromPrev: 0, distFromOrigin: 0 },
      { blobHash: 'h1', commitHash: 'c2', timestamp: 200, distFromPrev: 0.42, distFromOrigin: 0.42 },
    ])

    const result = await computeBranchSummary('feature/foo', 'main')

    expect(result.topChangedPaths).toHaveLength(1)
    expect(result.topChangedPaths[0].path).toBe('src/auth.ts')
    expect(result.topChangedPaths[0].semanticDrift).toBeCloseTo(0.42, 3)
  })

  it('uses baseBranch default of "main"', async () => {
    mockGetBranchExclusiveBlobs.mockReturnValue([])
    setDb(makeRawDb({}))

    const result = await computeBranchSummary('feature/foo')
    expect(result.baseBranch).toBe('main')
    expect(mockGetMergeBase).toHaveBeenCalledWith('feature/foo', 'main', '.')
  })

  it('uses custom baseBranch when provided', async () => {
    mockGetBranchExclusiveBlobs.mockReturnValue([])
    setDb(makeRawDb({}))

    await computeBranchSummary('feature/foo', 'develop')
    expect(mockGetMergeBase).toHaveBeenCalledWith('feature/foo', 'develop', '.')
  })
})
