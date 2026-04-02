import { describe, it, expect } from 'vitest'
import {
  renderClustersHtml,
  renderClusterDiffHtml,
  renderClusterTimelineHtml,
  renderConceptEvolutionHtml,
} from '../src/core/viz/htmlRenderer.js'
import type { ClusterReport, TemporalClusterReport, ClusterTimelineReport } from '../src/core/search/clustering.js'
import type { ConceptEvolutionEntry } from '../src/core/search/evolution.js'

// Minimal fixture data
const CLUSTER_A = {
  id: 1,
  label: 'auth',
  centroid: [0.1, 0.2],
  size: 10,
  representativePaths: ['src/auth/session.ts'],
  topKeywords: ['auth', 'session', 'token'],
  enhancedKeywords: ['authentication', 'jwt'],
}
const CLUSTER_B = {
  id: 2,
  label: 'database',
  centroid: [0.5, 0.6],
  size: 8,
  representativePaths: ['src/db/sqlite.ts'],
  topKeywords: ['db', 'query', 'schema'],
  enhancedKeywords: [],
}
const CLUSTER_REPORT: ClusterReport = {
  clusters: [CLUSTER_A, CLUSTER_B],
  edges: [{ fromId: 1, toId: 2, similarity: 0.4 }],
  totalBlobs: 18,
  k: 2,
  clusteredAt: 1700000000,
}
const TEMPORAL_REPORT: TemporalClusterReport = {
  ref1: '2024-01-01',
  ref2: '2024-06-01',
  before: { ...CLUSTER_REPORT, clusters: [CLUSTER_A] },
  after: { ...CLUSTER_REPORT, clusters: [CLUSTER_B] },
  changes: [
    {
      afterCluster: CLUSTER_B,
      beforeCluster: CLUSTER_A,
      centroidDrift: 0.12,
      stable: 5,
      newBlobs: 3,
      removedBlobs: 2,
      inflows: [{ fromClusterLabel: 'auth', count: 1 }],
      outflows: [{ toClusterLabel: 'database', count: 1 }],
    },
  ],
  newBlobsTotal: 3,
  removedBlobsTotal: 2,
  movedBlobsTotal: 1,
  stableBlobsTotal: 5,
}
const TIMELINE_REPORT: ClusterTimelineReport = {
  k: 2,
  since: 1600000000,
  until: 1700000000,
  steps: [
    {
      ref: '2020-09-13',
      timestamp: 1600000000,
      blobCount: 10,
      clusters: [
        { id: 1, label: 'auth', size: 5, topKeywords: ['auth'], representativePaths: ['src/auth.ts'], enhancedKeywords: [] },
      ],
      changes: null,
      stats: null,
      prevRef: null,
    },
    {
      ref: '2023-11-14',
      timestamp: 1700000000,
      blobCount: 18,
      clusters: [
        { id: 1, label: 'auth v2', size: 8, topKeywords: ['auth', 'jwt'], representativePaths: ['src/auth/jwt.ts'], enhancedKeywords: [] },
      ],
      changes: [
        {
          afterCluster: { id: 1, label: 'auth v2', size: 8, centroid: [], topKeywords: ['auth'], representativePaths: [], enhancedKeywords: [] },
          beforeCluster: { id: 1, label: 'auth', size: 5, centroid: [], topKeywords: ['auth'], representativePaths: [], enhancedKeywords: [] },
          centroidDrift: 0.2,
          stable: 4,
          newBlobs: 4,
          removedBlobs: 1,
          inflows: [],
          outflows: [],
        },
      ],
      stats: { newBlobs: 4, removedBlobs: 1, movedBlobs: 0, stableBlobs: 4 },
      prevRef: '2020-09-13',
    },
  ],
}
const ENTRIES: ConceptEvolutionEntry[] = [
  { blobHash: 'abc123', commitHash: 'def456', timestamp: 1640000000, paths: ['src/auth/login.ts'], score: 0.92, distFromPrev: 0 },
  { blobHash: 'ghi789', commitHash: 'jkl012', timestamp: 1650000000, paths: ['src/auth/jwt.ts'], score: 0.88, distFromPrev: 0.15 },
  { blobHash: 'mno345', commitHash: 'pqr678', timestamp: 1660000000, paths: ['src/auth/oauth.ts'], score: 0.75, distFromPrev: 0.42 },
]

describe('renderClustersHtml', () => {
  it('returns a string containing a complete HTML document', () => {
    const html = renderClustersHtml(CLUSTER_REPORT)
    expect(typeof html).toBe('string')
    expect(html.toLowerCase()).toContain('<!doctype html>')
    expect(html).toContain('<canvas')
    expect(html).toContain('Semantic Clusters')
  })

  it('embeds cluster count and blob count in the header', () => {
    const html = renderClustersHtml(CLUSTER_REPORT)
    expect(html).toContain('2')   // cluster count
    expect(html).toContain('18')  // blob count
  })

  it('includes cluster labels in the HTML', () => {
    const html = renderClustersHtml(CLUSTER_REPORT)
    expect(html).toContain('auth')
    expect(html).toContain('database')
  })

  it('embeds DATA JSON with clusters and edges', () => {
    const html = renderClustersHtml(CLUSTER_REPORT)
    expect(html).toContain('"label":"auth"')
    expect(html).toContain('"fromId":1')
    // centroid arrays must NOT be in the output (stripped for size)
    expect(html).not.toContain('"centroid"')
  })

  it('includes force simulation JS and PALETTE', () => {
    const html = renderClustersHtml(CLUSTER_REPORT)
    expect(html).toContain('simTick')
    expect(html).toContain('7aa2f7') // first palette color
  })
})

describe('renderClusterDiffHtml', () => {
  it('returns a complete HTML document', () => {
    const html = renderClusterDiffHtml(TEMPORAL_REPORT)
    expect(typeof html).toBe('string')
    expect(html.toLowerCase()).toContain('<!doctype html>')
  })

  it('includes both ref labels', () => {
    const html = renderClusterDiffHtml(TEMPORAL_REPORT)
    expect(html).toContain('2024-01-01')
    expect(html).toContain('2024-06-01')
  })

  it('includes blob change stats in the header', () => {
    const html = renderClusterDiffHtml(TEMPORAL_REPORT)
    expect(html).toContain('new:')
    expect(html).toContain('removed:')
    expect(html).toContain('moved:')
  })

  it('embeds DATA JSON with changes', () => {
    const html = renderClusterDiffHtml(TEMPORAL_REPORT)
    expect(html).toContain('"centroidDrift"')
  })
})

describe('renderClusterTimelineHtml', () => {
  it('returns a complete HTML document', () => {
    const html = renderClusterTimelineHtml(TIMELINE_REPORT)
    expect(typeof html).toBe('string')
    expect(html.toLowerCase()).toContain('<!doctype html>')
    expect(html).toContain('Cluster Timeline')
  })

  it('includes since and until dates in the header', () => {
    const html = renderClusterTimelineHtml(TIMELINE_REPORT)
    expect(html).toContain('2020-09-13')   // since date
    expect(html).toContain('2023-11-14')   // until date
  })

  it('uses provided threshold in the script', () => {
    const html = renderClusterTimelineHtml(TIMELINE_REPORT, 0.25)
    expect(html).toContain('0.25')
  })

  it('defaults threshold to 0.15', () => {
    const html = renderClusterTimelineHtml(TIMELINE_REPORT)
    expect(html).toContain('0.15')
  })
})

describe('renderConceptEvolutionHtml', () => {
  it('returns a complete HTML document', () => {
    const html = renderConceptEvolutionHtml('authentication', ENTRIES, 0.3)
    expect(typeof html).toBe('string')
    expect(html.toLowerCase()).toContain('<!doctype html>')
    expect(html).toContain('Concept Evolution')
  })

  it('includes the query in the header', () => {
    const html = renderConceptEvolutionHtml('authentication', ENTRIES, 0.3)
    expect(html).toContain('authentication')
  })

  it('includes entry count in the header', () => {
    const html = renderConceptEvolutionHtml('authentication', ENTRIES, 0.3)
    expect(html).toContain('3')    // entry count
    expect(html).toContain('1')    // large changes count (one entry with dist >= 0.3)
  })

  it('embeds entry data as JSON', () => {
    const html = renderConceptEvolutionHtml('authentication', ENTRIES, 0.3)
    expect(html).toContain('"blobHash":"abc123"')
    expect(html).toContain('"score":0.92')
  })

  it('handles empty entries gracefully', () => {
    const html = renderConceptEvolutionHtml('nothing', [], 0.3)
    expect(html.toLowerCase()).toContain('<!doctype html>')
    expect(html).toContain('"entries":[]')
  })

  it('escapes HTML in query to prevent XSS', () => {
    const html = renderConceptEvolutionHtml('<script>alert(1)</script>', [], 0.3)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
