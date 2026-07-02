/**
 * HTTP integration tests for the Phase 148 `/api/v1/insights/*` routes —
 * new routes for CLI commands (`bisect`, `refactor-candidates`, `lifecycle`,
 * `cherry-pick-suggest`, `file-diff`, `pr-report`, `regression-gate`,
 * `code-review`, `heatmap`, `map`) that previously had no HTTP route or MCP
 * tool at all.
 *
 * Kept in a dedicated file (rather than appended to tests/serverRoutes.test.ts)
 * to avoid merge conflicts with other phases landing HTTP route tests in
 * parallel. Same setup pattern: a real Express app (createApp) backed by an
 * in-memory SQLite DB and a deterministic mock embedding provider.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { vi } from 'vitest'

vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  const session = actual.openDatabaseAt(':memory:')
  return {
    ...actual,
    getActiveSession: () => session,
    db: session.db,
  }
})

import { createApp } from '../src/server/app.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
const mockProvider: EmbeddingProvider = {
  model: 'mock',
  embed: async () => [...MOCK_VEC],
  embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
  dimensions: 4,
}

let app: ReturnType<typeof createApp>

beforeAll(async () => {
  app = createApp({ textProvider: mockProvider })
})

describe('POST /api/v1/insights/bisect', () => {
  it('returns 200 with a bisect report on an empty DB', async () => {
    const res = await request(app)
      .post('/api/v1/insights/bisect')
      .send({ goodRef: 'main', badRef: 'HEAD', query: 'authentication flow' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('query', 'authentication flow')
    expect(Array.isArray(res.body.steps)).toBe(true)
  })

  it('returns 400 on missing required fields', async () => {
    const res = await request(app).post('/api/v1/insights/bisect').send({})
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/insights/refactor-candidates', () => {
  it('returns 200 with an empty report on an empty DB', async () => {
    const res = await request(app).post('/api/v1/insights/refactor-candidates').send({})
    expect(res.status).toBe(200)
    expect(res.body.pairs).toEqual([])
  })
})

describe('POST /api/v1/insights/lifecycle', () => {
  it('returns 200 with a lifecycle report on an empty DB', async () => {
    const res = await request(app)
      .post('/api/v1/insights/lifecycle')
      .send({ query: 'authentication flow' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('query', 'authentication flow')
    expect(res.body).toHaveProperty('currentStage')
  })

  it('returns 400 without a query', async () => {
    const res = await request(app).post('/api/v1/insights/lifecycle').send({})
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/insights/cherry-pick-suggest', () => {
  it('returns 200 with an empty results array on an empty DB', async () => {
    const res = await request(app)
      .post('/api/v1/insights/cherry-pick-suggest')
      .send({ query: 'fix login bug' })
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })
})

describe('POST /api/v1/insights/file-diff', () => {
  it('returns 200 with null blob hashes for a nonexistent path', async () => {
    const res = await request(app)
      .post('/api/v1/insights/file-diff')
      .send({ ref1: 'HEAD', ref2: 'HEAD', path: 'definitely-not-a-real-file-xyz.ts' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('cosineDistance', null)
  })

  it('returns 400 on missing fields', async () => {
    const res = await request(app).post('/api/v1/insights/file-diff').send({ ref1: 'HEAD' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/insights/pr-report', () => {
  it('returns 200 with a reviewerSuggestions section on an empty DB', async () => {
    const res = await request(app).post('/api/v1/insights/pr-report').send({})
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('ref1', 'HEAD~1')
    expect(res.body).toHaveProperty('reviewerSuggestions')
  })
})

describe('POST /api/v1/insights/regression-gate', () => {
  it('returns 200 (all passed) for a zero-drift empty DB', async () => {
    const res = await request(app)
      .post('/api/v1/insights/regression-gate')
      .send({ queries: [{ query: 'authentication flow' }] })
    expect(res.status).toBe(200)
    expect(res.body.allPassed).toBe(true)
  })

  // The "gate failed" (422) path needs a genuine base/head score delta,
  // which requires seeded, branch-tagged embeddings — exercised at the core
  // function level instead (see computeRegressionGate tests in
  // tests/insightsTools.test.ts, which pass an out-of-schema-range threshold
  // directly to force `passed: false` without needing indexed data).
  it('rejects an out-of-range top-level threshold with 400', async () => {
    const res = await request(app)
      .post('/api/v1/insights/regression-gate')
      .send({ queries: [{ query: 'authentication flow' }], threshold: -1 })
    expect(res.status).toBe(400)
  })

  it('returns 400 on an empty queries array', async () => {
    const res = await request(app).post('/api/v1/insights/regression-gate').send({ queries: [] })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/insights/code-review', () => {
  it('returns 200 with a reviews array for a simple diff', async () => {
    const diffText = 'diff --git a/foo.ts b/foo.ts\n+function hello() {}\n'
    const res = await request(app)
      .post('/api/v1/insights/code-review')
      .send({ diffText })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.reviews)).toBe(true)
    expect(res.body.reviews[0]).toHaveProperty('regressionRisk', 'low')
  })

  it('returns 400 on missing diffText', async () => {
    const res = await request(app).post('/api/v1/insights/code-review').send({})
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/insights/heatmap', () => {
  it('returns 200 with an empty buckets object on an empty DB', async () => {
    const res = await request(app).post('/api/v1/insights/heatmap').send({})
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('period', 'week')
    expect(res.body.buckets).toEqual({})
  })
})

describe('POST /api/v1/insights/map', () => {
  it('returns 200 with an empty clusters array on an empty DB', async () => {
    const res = await request(app).post('/api/v1/insights/map').send({})
    expect(res.status).toBe(200)
    expect(res.body.clusters).toEqual([])
  })
})
