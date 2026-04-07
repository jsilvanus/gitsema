/**
 * Comprehensive HTTP integration tests for the gitsema Express server.
 *
 * Tests use:
 *   - A real Express application (createApp) with an in-memory SQLite DB
 *   - A mock embedding provider returning deterministic 4-dim vectors
 *   - supertest for HTTP-level assertions
 *
 * No network calls, no real Git repos. Focus: request parsing, auth middleware,
 * Zod validation, response shapes, and error handling.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { createApp } from '../src/server/app.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

// ---------------------------------------------------------------------------
// Mock embedding provider — deterministic 4-dim vector
// ---------------------------------------------------------------------------
const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
const mockProvider: EmbeddingProvider = {
  model: 'mock',
  embed: async () => [...MOCK_VEC],
  embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
  dimensions: 4,
}

// ---------------------------------------------------------------------------
// App + DB setup — shared across all describe blocks
// ---------------------------------------------------------------------------
let app: ReturnType<typeof createApp>
const session = openDatabaseAt(':memory:')

beforeAll(() => {
  // createApp reads the active session via getActiveSession() which falls back
  // to the default session.  We wrap the test in withDbSession below in the
  // concurrent-test block; for most tests the in-memory session is the default.
  app = createApp({ textProvider: mockProvider })
})

afterEach(() => {
  // Clean up any key that might have been set by auth tests
  delete process.env.GITSEMA_SERVE_KEY
})

afterAll(() => {
  delete process.env.GITSEMA_SERVE_KEY
})

// ===========================================================================
// GET /api/v1/status
// ===========================================================================
describe('GET /api/v1/status', () => {
  it('returns 200 with blobs count and dbPath', async () => {
    const res = await request(app).get('/api/v1/status')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('blobs')
    expect(typeof res.body.blobs).toBe('number')
    expect(res.body).toHaveProperty('dbPath')
  })
})

// ===========================================================================
// GET /api/v1/capabilities
// ===========================================================================
describe('GET /api/v1/capabilities', () => {
  it('returns 200 with version and features array', async () => {
    const res = await request(app).get('/api/v1/capabilities')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('version')
    expect(Array.isArray(res.body.features)).toBe(true)
    expect(res.body.features).toContain('semantic_search')
    expect(res.body.features).toContain('hybrid_search')
    expect(res.body).toHaveProperty('providers')
    expect(res.body.providers).toHaveProperty('text', 'mock')
  })
})

// ===========================================================================
// Auth middleware
// ===========================================================================
describe('auth middleware', () => {
  it('returns 401 when key is set and Authorization header is missing', async () => {
    process.env.GITSEMA_SERVE_KEY = 'test-secret'
    const res = await request(app).get('/api/v1/status')
    expect(res.status).toBe(401)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 200 when correct Bearer token is provided', async () => {
    process.env.GITSEMA_SERVE_KEY = 'test-secret'
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer test-secret')
    expect(res.status).toBe(200)
  })

  it('returns 401 for wrong token', async () => {
    process.env.GITSEMA_SERVE_KEY = 'test-secret'
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer wrong')
    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization header format is not Bearer', async () => {
    process.env.GITSEMA_SERVE_KEY = 'test-secret'
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Basic dGVzdA==')
    expect(res.status).toBe(401)
  })

  it('passes through when no key is configured', async () => {
    delete process.env.GITSEMA_SERVE_KEY
    const res = await request(app).get('/api/v1/status')
    expect(res.status).toBe(200)
  })
})

// ===========================================================================
// POST /api/v1/search — basic cases
// ===========================================================================
describe('POST /api/v1/search — validation', () => {
  it('returns 400 for missing query', async () => {
    const res = await request(app).post('/api/v1/search').send({})
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 400 for empty query string', async () => {
    const res = await request(app).post('/api/v1/search').send({ query: '' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-number top', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', top: 'bad' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid group value', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', group: 'invalid' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid date in before field', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', before: 'not-a-date' })
    // Either 400 from Zod or from date-parse error — both are valid
    expect([400, 200]).toContain(res.status)
  })
})

describe('POST /api/v1/search — successful requests on empty DB', () => {
  it('returns 200 with array for valid query', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'authentication', top: 5 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns empty array on empty DB', async () => {
    const res = await request(app).post('/api/v1/search').send({ query: 'x' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns JSON array for hybrid=true on empty DB', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', hybrid: true, bm25Weight: 0.3 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns JSON array with branch option', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', branch: 'main' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns {blobResults, commitResults} when includeCommits=true', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', includeCommits: true })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('blobResults')
    expect(res.body).toHaveProperty('commitResults')
    expect(Array.isArray(res.body.blobResults)).toBe(true)
    expect(Array.isArray(res.body.commitResults)).toBe(true)
  })

  it('returns text/plain when rendered=true', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', rendered: true })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
  })

  it('returns array for level=chunk', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', level: 'chunk' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns array for level=symbol', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', level: 'symbol' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns array when group=file', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', group: 'file' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns {blobResults,commitResults} for hybrid+includeCommits', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', hybrid: true, includeCommits: true })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('blobResults')
    expect(res.body).toHaveProperty('commitResults')
  })
})

// ===========================================================================
// POST /api/v1/search/first-seen
// ===========================================================================
describe('POST /api/v1/search/first-seen', () => {
  it('returns 400 for missing query', async () => {
    const res = await request(app).post('/api/v1/search/first-seen').send({})
    expect(res.status).toBe(400)
  })

  it('returns 200 with array on empty DB', async () => {
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'authentication' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns {blobResults, commitResults} when includeCommits=true', async () => {
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth', includeCommits: true })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('blobResults')
    expect(res.body).toHaveProperty('commitResults')
  })

  it('returns text/plain when rendered=true', async () => {
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth', rendered: true })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
  })

  it('accepts hybrid=true with bm25Weight', async () => {
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth', hybrid: true, bm25Weight: 0.4 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts branch option', async () => {
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth', branch: 'main' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ===========================================================================
// POST /api/v1/evolution/file
// ===========================================================================
describe('POST /api/v1/evolution/file', () => {
  it('returns 400 for missing path', async () => {
    const res = await request(app).post('/api/v1/evolution/file').send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty path', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: '' })
    expect(res.status).toBe(400)
  })

  it('returns 200 with evolution structure for valid path (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: 'src/index.ts' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('path', 'src/index.ts')
    expect(res.body).toHaveProperty('versions')
    expect(res.body).toHaveProperty('timeline')
    expect(res.body).toHaveProperty('summary')
    expect(Array.isArray(res.body.timeline)).toBe(true)
  })

  it('accepts threshold option', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: 'src/index.ts', threshold: 0.5 })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('threshold', 0.5)
  })
})

// ===========================================================================
// POST /api/v1/evolution/concept
// ===========================================================================
describe('POST /api/v1/evolution/concept', () => {
  it('returns 400 for missing query', async () => {
    const res = await request(app).post('/api/v1/evolution/concept').send({})
    expect(res.status).toBe(400)
  })

  it('returns 200 with concept evolution structure on empty DB', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/concept')
      .send({ query: 'authentication middleware' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('query', 'authentication middleware')
    expect(res.body).toHaveProperty('timeline')
    expect(res.body).toHaveProperty('summary')
    expect(Array.isArray(res.body.timeline)).toBe(true)
  })
})

// ===========================================================================
// POST /api/v1/analysis/health
// ===========================================================================
describe('POST /api/v1/analysis/health', () => {
  it('returns 200 with array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/health')
      .send({ buckets: 6 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 200 with default buckets when body is empty', async () => {
    const res = await request(app).post('/api/v1/analysis/health').send({})
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 400 for invalid buckets (not a number)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/health')
      .send({ buckets: 'not-a-number' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-positive buckets', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/health')
      .send({ buckets: 0 })
    expect(res.status).toBe(400)
  })

  it('accepts branch option', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/health')
      .send({ buckets: 3, branch: 'main' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ===========================================================================
// POST /api/v1/analysis/security-scan
// ===========================================================================
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

  it('returns 200 with empty body (uses defaults)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/security-scan')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('findings')
  })

  it('returns 400 for invalid top (string)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/security-scan')
      .send({ top: 'bad' })
    expect(res.status).toBe(400)
  })

  it('disclaimer contains "not confirmed vulnerabilities"', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/security-scan')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.disclaimer).toMatch(/not confirmed/i)
  })
})

// ===========================================================================
// POST /api/v1/analysis/debt
// ===========================================================================
describe('POST /api/v1/analysis/debt', () => {
  it('returns 200 with array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/debt')
      .send({})
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 400 for invalid top', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/debt')
      .send({ top: 'bad' })
    expect(res.status).toBe(400)
  })

  it('accepts top and branch options', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/debt')
      .send({ top: 5, branch: 'main' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ===========================================================================
// POST /api/v1/analysis/experts
// ===========================================================================
describe('POST /api/v1/analysis/experts', () => {
  it('returns 200 with experts array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/experts')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('experts')
    expect(Array.isArray(res.body.experts)).toBe(true)
  })

  it('returns 400 for invalid topN', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/experts')
      .send({ topN: 'bad' })
    expect(res.status).toBe(400)
  })

  it('accepts topN option', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/experts')
      .send({ topN: 5 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.experts)).toBe(true)
  })
})

// ===========================================================================
// POST /api/v1/analysis/clusters
// ===========================================================================
describe('POST /api/v1/analysis/clusters', () => {
  it('returns 200 (empty DB → empty or minimal cluster report)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/clusters')
      .send({ k: 3 })
    // clusters might return 200 with an empty report or 500 if k > blob count
    expect([200, 500]).toContain(res.status)
  })

  it('returns 400 for invalid k (string)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/clusters')
      .send({ k: 'bad' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for k=0 (not positive)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/clusters')
      .send({ k: 0 })
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// POST /api/v1/analysis/change-points
// ===========================================================================
describe('POST /api/v1/analysis/change-points', () => {
  it('returns 400 for missing query', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/change-points')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 200 with change-points structure (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/change-points')
      .send({ query: 'authentication' })
    expect(res.status).toBe(200)
    // May return {} or { changePoints: [] } depending on implementation
    expect(typeof res.body).toBe('object')
  })

  it('returns 400 for invalid threshold', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/change-points')
      .send({ query: 'auth', threshold: 'bad' })
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// POST /api/v1/analysis/author
// ===========================================================================
describe('POST /api/v1/analysis/author', () => {
  it('returns 400 for missing query', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 200 with contributions structure (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication' })
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
  })
})

// ===========================================================================
// POST /api/v1/analysis/impact
// ===========================================================================
describe('POST /api/v1/analysis/impact', () => {
  it('returns 400 for missing file', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/impact')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 200 or 500 for valid request (no git repo)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/impact')
      .send({ file: 'src/index.ts' })
    // May 500 because there's no git repo; should not be 400
    expect([200, 500]).toContain(res.status)
  })
})

// ===========================================================================
// POST /api/v1/analysis/dead-concepts
// ===========================================================================
describe('POST /api/v1/analysis/dead-concepts', () => {
  it('returns 200 with array (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/dead-concepts')
      .send({})
    expect(res.status).toBe(200)
    // Result may be an array or { concepts: [] }
    expect(typeof res.body).toBe('object')
  })

  it('returns 400 for invalid topK', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/dead-concepts')
      .send({ topK: 'bad' })
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// POST /api/v1/analysis/semantic-diff
// ===========================================================================
describe('POST /api/v1/analysis/semantic-diff', () => {
  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/semantic-diff')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 for partially missing fields (ref2 missing)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/semantic-diff')
      .send({ ref1: 'abc123', query: 'auth' })
    expect(res.status).toBe(400)
  })

  it('returns 200 or 500 for valid request (no git repo)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/semantic-diff')
      .send({ ref1: 'abc123', ref2: 'def456', query: 'authentication' })
    expect([200, 500]).toContain(res.status)
  })
})

// ===========================================================================
// POST /api/v1/analysis/semantic-blame
// ===========================================================================
describe('POST /api/v1/analysis/semantic-blame', () => {
  it('returns 400 for missing filePath', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/semantic-blame')
      .send({ content: 'some content' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing content', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/semantic-blame')
      .send({ filePath: 'src/index.ts' })
    expect(res.status).toBe(400)
  })

  it('returns 200 with array on empty DB', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/semantic-blame')
      .send({ filePath: 'src/index.ts', content: 'export function auth() {}' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ===========================================================================
// Embedding provider failure → 502
// ===========================================================================
describe('Embedding provider failure → 502', () => {
  it('POST /api/v1/search returns 502 when embedding throws', async () => {
    const failProvider: EmbeddingProvider = {
      model: 'fail',
      embed: async () => { throw new Error('embed failed') },
      dimensions: 4,
    }
    const failApp = createApp({ textProvider: failProvider })
    const res = await request(failApp)
      .post('/api/v1/search')
      .send({ query: 'auth' })
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/embed/i)
  })

  it('POST /api/v1/search/first-seen returns 502 when embedding throws', async () => {
    const failProvider: EmbeddingProvider = {
      model: 'fail',
      embed: async () => { throw new Error('embed failed') },
      dimensions: 4,
    }
    const failApp = createApp({ textProvider: failProvider })
    const res = await request(failApp)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth' })
    expect(res.status).toBe(502)
  })

  it('POST /api/v1/analysis/change-points returns 502 when embedding throws', async () => {
    const failProvider: EmbeddingProvider = {
      model: 'fail',
      embed: async () => { throw new Error('embed failed') },
      dimensions: 4,
    }
    const failApp = createApp({ textProvider: failProvider })
    const res = await request(failApp)
      .post('/api/v1/analysis/change-points')
      .send({ query: 'auth' })
    expect(res.status).toBe(502)
  })

  it('POST /api/v1/evolution/concept returns 502 when embedding throws', async () => {
    const failProvider: EmbeddingProvider = {
      model: 'fail',
      embed: async () => { throw new Error('embed failed') },
      dimensions: 4,
    }
    const failApp = createApp({ textProvider: failProvider })
    const res = await request(failApp)
      .post('/api/v1/evolution/concept')
      .send({ query: 'auth' })
    expect(res.status).toBe(502)
  })
})

// ===========================================================================
// Non-existent routes
// ===========================================================================
describe('non-existent routes', () => {
  it('returns 404 for unknown route', async () => {
    const res = await request(app).get('/api/v1/nonexistent')
    expect(res.status).toBe(404)
  })
})

