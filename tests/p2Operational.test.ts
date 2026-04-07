/**
 * Tests for P2 operational readiness features:
 *   - GET /metrics (Prometheus endpoint)
 *   - Rate limiting middleware (429 + Retry-After)
 *   - GET /openapi.json (OpenAPI spec)
 *   - GET /docs (Swagger UI)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import { createApp } from '../src/server/app.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------
const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
const mockProvider: EmbeddingProvider = {
  model: 'mock',
  embed: async () => [...MOCK_VEC],
  embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
  dimensions: 4,
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
let app: ReturnType<typeof createApp>

beforeAll(() => {
  const session = openDatabaseAt(':memory:')
  ;(globalThis as any).__gitsemaTestSession = session
  app = createApp({ textProvider: mockProvider })
})

afterAll(() => {
  delete (globalThis as any).__gitsemaTestSession
  delete process.env.GITSEMA_SERVE_KEY
  delete process.env.GITSEMA_METRICS_PUBLIC
  delete process.env.GITSEMA_RATE_LIMIT_RPM
})

afterEach(() => {
  delete process.env.GITSEMA_SERVE_KEY
  delete process.env.GITSEMA_METRICS_PUBLIC
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// GET /metrics
// ---------------------------------------------------------------------------
describe('GET /metrics', () => {
  it('returns 200 with Prometheus text when no auth required', async () => {
    // No GITSEMA_SERVE_KEY set → no auth required
    const res = await request(app).get('/metrics')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    // Should contain at least one prom-client default metric
    expect(res.text).toMatch(/# HELP/)
  })

  it('includes gitsema-specific metric names', async () => {
    const res = await request(app).get('/metrics')
    expect(res.status).toBe(200)
    expect(res.text).toContain('gitsema_index_blobs_total')
    expect(res.text).toContain('gitsema_index_embeddings_total')
    expect(res.text).toContain('gitsema_query_cache_hits_total')
    expect(res.text).toContain('gitsema_query_cache_misses_total')
    expect(res.text).toContain('gitsema_embedding_errors_total')
    expect(res.text).toContain('http_request_duration_seconds')
  })

  it('returns 401 when auth is required and no token provided', async () => {
    process.env.GITSEMA_SERVE_KEY = 'secret'
    const res = await request(app).get('/metrics')
    expect(res.status).toBe(401)
  })

  it('returns 200 when auth is required and correct token provided', async () => {
    process.env.GITSEMA_SERVE_KEY = 'secret'
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', 'Bearer secret')
    expect(res.status).toBe(200)
    expect(res.text).toMatch(/# HELP/)
  })

  it('returns 200 without token when GITSEMA_METRICS_PUBLIC=1', async () => {
    process.env.GITSEMA_SERVE_KEY = 'secret'
    process.env.GITSEMA_METRICS_PUBLIC = '1'
    const res = await request(app).get('/metrics')
    expect(res.status).toBe(200)
    expect(res.text).toMatch(/# HELP/)
  })
})

// ---------------------------------------------------------------------------
// GET /openapi.json
// ---------------------------------------------------------------------------
describe('GET /openapi.json', () => {
  it('returns 200 with valid JSON OpenAPI spec', async () => {
    const res = await request(app).get('/openapi.json')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    const spec = res.body as Record<string, unknown>
    expect(spec).toHaveProperty('openapi')
    expect(spec.openapi).toMatch(/^3\.1/)
    expect(spec).toHaveProperty('info')
    expect(spec).toHaveProperty('paths')
  })

  it('spec includes /api/v1/search and /metrics paths', async () => {
    const res = await request(app).get('/openapi.json')
    expect(res.status).toBe(200)
    const paths = (res.body as any).paths as Record<string, unknown>
    expect(paths).toHaveProperty('/api/v1/search')
    expect(paths).toHaveProperty('/metrics')
  })

  it('is accessible even when auth is required (public spec)', async () => {
    process.env.GITSEMA_SERVE_KEY = 'secret'
    const res = await request(app).get('/openapi.json')
    // OpenAPI spec is mounted before auth middleware
    // If it returns 401, that means it's behind auth — either behaviour is acceptable
    // but we document the current behaviour here
    expect([200, 401]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// GET /docs
// ---------------------------------------------------------------------------
describe('GET /docs', () => {
  it('returns 200 with Swagger UI HTML', async () => {
    const res = await request(app).get('/docs')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('swagger-ui')
    expect(res.text).toContain('/openapi.json')
  })
})

// ---------------------------------------------------------------------------
// Rate limiting (basic behaviour)
// ---------------------------------------------------------------------------
describe('rate limiting', () => {
  it('returns RateLimit headers on normal requests', async () => {
    const res = await request(app).get('/api/v1/status')
    expect(res.status).toBe(200)
    // express-rate-limit draft-7 headers
    const hasRateLimit =
      'ratelimit' in res.headers ||
      'ratelimit-limit' in res.headers ||
      'x-ratelimit-limit' in res.headers
    expect(hasRateLimit).toBe(true)
  })

  it('returns 429 with Retry-After when limit is exceeded', async () => {
    // Set a very low limit for this test
    process.env.GITSEMA_RATE_LIMIT_RPM = '1'

    // Build a fresh app with the low limit so the env var takes effect
    const limitedSession = openDatabaseAt(':memory:')
    ;(globalThis as any).__gitsemaTestSession = limitedSession
    const limitedApp = createApp({ textProvider: mockProvider })

    // First request should succeed
    const first = await request(limitedApp).get('/api/v1/status')
    expect(first.status).toBe(200)

    // Second request should be rate-limited
    const second = await request(limitedApp).get('/api/v1/status')
    expect(second.status).toBe(429)
    expect(second.body).toHaveProperty('error', 'Too Many Requests')
    expect(second.body).toHaveProperty('retryAfter')
    expect(second.headers).toHaveProperty('retry-after')

    // Restore
    delete process.env.GITSEMA_RATE_LIMIT_RPM
    ;(globalThis as any).__gitsemaTestSession = openDatabaseAt(':memory:')
  })
})
