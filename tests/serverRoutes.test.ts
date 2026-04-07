/**
 * M3: Minimal supertest suite for the five most-critical HTTP server routes.
 *
 * Tests use a real Express application (createApp) with:
 *   - an in-memory SQLite database (via withDbSession)
 *   - a no-op mock EmbeddingProvider that returns a stable 4-dim embedding
 *
 * No network calls are made. The focus is on request parsing, auth middleware,
 * error handling, and JSON response shapes — not search result correctness.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import { createApp } from '../src/server/app.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

// ---------------------------------------------------------------------------
// Mock embedding provider — always returns the same 4-dim vector
// ---------------------------------------------------------------------------
const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
const mockProvider: EmbeddingProvider = {
  model: 'mock',
  embed: async () => [...MOCK_VEC],
  embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
  dimensions: 4,
}

// ---------------------------------------------------------------------------
// App and DB setup
// ---------------------------------------------------------------------------
let app: ReturnType<typeof createApp>

beforeAll(() => {
  // Open an isolated in-memory DB for every test run
  const session = openDatabaseAt(':memory:')
  // Set as active session so route handlers can call getActiveSession()
  ;(globalThis as any).__gitsemaTestSession = session

  app = createApp({ textProvider: mockProvider })
})

afterAll(() => {
  delete (globalThis as any).__gitsemaTestSession
  delete process.env.GITSEMA_SERVE_KEY
})

// ---------------------------------------------------------------------------
// GET /api/v1/status
// ---------------------------------------------------------------------------
describe('GET /api/v1/status', () => {
  it('returns 200 with blobs count and dbPath', async () => {
    const res = await request(app).get('/api/v1/status')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('blobs')
    expect(res.body).toHaveProperty('dbPath')
  })
})

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
describe('auth middleware', () => {
  it('returns 401 when key is set and Authorization header is missing', async () => {
    process.env.GITSEMA_SERVE_KEY = 'test-secret'
    const res = await request(app).get('/api/v1/status')
    expect(res.status).toBe(401)
    delete process.env.GITSEMA_SERVE_KEY
  })

  it('returns 200 when correct Bearer token is provided', async () => {
    process.env.GITSEMA_SERVE_KEY = 'test-secret'
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer test-secret')
    expect(res.status).toBe(200)
    delete process.env.GITSEMA_SERVE_KEY
  })

  it('returns 401 for wrong token', async () => {
    process.env.GITSEMA_SERVE_KEY = 'test-secret'
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer wrong')
    expect(res.status).toBe(401)
    delete process.env.GITSEMA_SERVE_KEY
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/search
// ---------------------------------------------------------------------------
describe('POST /api/v1/search', () => {
  it('returns 400 for missing query', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 200 with an array for valid query (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'authentication', top: 5 })
    expect(res.status).toBe(200)
    // Search returns an array directly or {blobResults, commitResults}
    const isArr = Array.isArray(res.body)
    const hasBlob = typeof res.body === 'object' && 'blobResults' in res.body
    expect(isArr || hasBlob).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/health
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/health', () => {
  it('returns 200 with array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/health')
      .send({ buckets: 6 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 400 for invalid body', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/health')
      .send({ buckets: 'not-a-number' })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/security-scan
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/security-scan', () => {
  it('returns 200 with disclaimer and findings array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/security-scan')
      .send({ top: 3 })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('disclaimer')
    expect(res.body).toHaveProperty('findings')
    expect(Array.isArray(res.body.findings)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/experts
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/experts', () => {
  it('returns 200 with experts array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/experts')
      .send({})
    expect(res.status).toBe(200)
    // The experts route returns an object with an "experts" key
    expect(res.body).toHaveProperty('experts')
    expect(Array.isArray(res.body.experts)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/doc-gap
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/doc-gap', () => {
  it('returns 200 with an array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/doc-gap')
      .send({ top: 5 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 400 for invalid body', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/doc-gap')
      .send({ top: -1 })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/contributor-profile
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/contributor-profile', () => {
  it('returns 200 with an array (empty DB, unknown author)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/contributor-profile')
      .send({ author: 'nobody', top: 5 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 400 when author is missing', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/contributor-profile')
      .send({})
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/triage
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/triage', () => {
  it('returns 200 with query + sections (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/triage')
      .send({ query: 'authentication', top: 3 })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('query', 'authentication')
    expect(res.body).toHaveProperty('sections')
  })

  it('returns 400 when query is missing', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/triage')
      .send({})
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/policy-check
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/policy-check', () => {
  it('returns 200 with passed=true (no checks set, empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/policy-check')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('passed', true)
    expect(res.body).toHaveProperty('checks')
  })

  it('returns 400 when maxDrift is set without query', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/policy-check')
      .send({ maxDrift: 0.5 })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/ownership
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/ownership', () => {
  it('returns 200 with an array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/ownership')
      .send({ query: 'authentication middleware' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 400 when query is missing', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/ownership')
      .send({})
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/workflow
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/workflow', () => {
  it('returns 200 for incident template with query', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/workflow')
      .send({ template: 'incident', query: 'database crash', top: 3 })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('template', 'incident')
    expect(res.body).toHaveProperty('sections')
  })

  it('returns 200 for release-audit template without query', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/workflow')
      .send({ template: 'release-audit' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('template', 'release-audit')
  })

  it('returns 400 for unknown template', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/workflow')
      .send({ template: 'unknown' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for pr-review without file', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/workflow')
      .send({ template: 'pr-review' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for incident without query', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/workflow')
      .send({ template: 'incident' })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/eval
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/eval', () => {
  it('returns 200 with cases and summary for valid inline cases', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/eval')
      .send({
        cases: [{ query: 'authentication', expectedPaths: ['src/auth.ts'] }],
        top: 5,
      })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('cases')
    expect(res.body).toHaveProperty('summary')
    expect(Array.isArray(res.body.cases)).toBe(true)
    const summary = res.body.summary
    expect(summary).toHaveProperty('avgPrecision')
    expect(summary).toHaveProperty('avgRecall')
    expect(summary).toHaveProperty('avgMRR')
  })

  it('returns 400 for missing cases', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/eval')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty cases array', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/eval')
      .send({ cases: [] })
    expect(res.status).toBe(400)
  })
})
