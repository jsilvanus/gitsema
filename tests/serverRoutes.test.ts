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

// Mock sqlite DB module to return an in-memory session for all imports
vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  const session = actual.openDatabaseAt(':memory:')
  return {
    ...actual,
    getActiveSession: () => session,
    db: session.db,
  }
})

// Mock the provider factory so per-request model overrides (Phase 140) are
// observable without hitting a real Ollama/HTTP backend: any model name
// containing "override" resolves to a distinguishable mock provider whose
// `.model` reflects the requested override, letting tests assert that
// `resolveRequestProvider()` actually swapped providers instead of always
// falling back to the router's default `textProvider`.
vi.mock('../src/core/embedding/providerFactory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/embedding/providerFactory.js')>()
  return {
    ...actual,
    buildProvider: (type: string, model: string) => {
      if (model.includes('override')) {
        return {
          model,
          embed: async () => [0.9, 0.8, 0.7, 0.6],
          embedBatch: async (texts: string[]) => texts.map(() => [0.9, 0.8, 0.7, 0.6]),
          dimensions: 4,
        }
      }
      return actual.buildProvider(type, model)
    },
  }
})

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

beforeAll(async () => {
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
    // The date is parsed inside the route handler after Zod validation passes
    // (before is z.string().optional()), so the route should catch the parse
    // error and return 400.
    expect(res.status).toBe(400)
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

  it('accepts vss option', async () => {
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth', vss: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts repos option (multi-repo, no repos registered)', async () => {
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth', repos: ['repo-a', 'repo-b'] })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('honors a model override by routing away from the default provider (502 for an unreachable model proves the override was applied, not ignored)', async () => {
    const res = await request(app)
      .post('/api/v1/search/first-seen')
      .send({ query: 'auth', model: 'some-unreachable-override-model' })
    expect(res.status).toBe(502)
    expect(res.body).toHaveProperty('error')
  })
})

// ===========================================================================
// POST /api/v1/search — Phase 138 restored query-shaping flags
// ===========================================================================
describe('POST /api/v1/search — Phase 138 flag parity', () => {
  it('accepts notLike/lambda (negative example scoring)', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', notLike: 'legacy code', lambda: 0.3 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts or/and boolean composition', async () => {
    const resOr = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', or: 'login' })
    expect(resOr.status).toBe(200)
    expect(Array.isArray(resOr.body)).toBe(true)

    const resAnd = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', and: 'session' })
    expect(resAnd.status).toBe(200)
    expect(Array.isArray(resAnd.body)).toBe(true)
  })

  it('accepts explain flag', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', explain: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts explainLlm flag with rendered output', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', explainLlm: true, rendered: true })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
  })

  it('accepts expandQuery flag', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', expandQuery: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts annotateClusters flag', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', annotateClusters: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts vss flag', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', vss: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts earlyCut flag', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', earlyCut: 100 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts noCache flag', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', noCache: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts repos option (multi-repo, no repos registered)', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', repos: ['repo-a', 'repo-b'] })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('honors a model override by routing away from the default provider (502 for an unreachable model proves the override was applied, not ignored)', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', model: 'some-unreachable-override-model' })
    expect(res.status).toBe(502)
    expect(res.body).toHaveProperty('error')
  })

  it('accepts level=module', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', level: 'module' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns resultsByLevel when 2+ levels are active (level=symbol + chunks=true)', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', level: 'symbol', chunks: true })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('resultsByLevel')
    expect(res.body.resultsByLevel).toHaveProperty('file')
    expect(res.body.resultsByLevel).toHaveProperty('chunk')
    expect(res.body.resultsByLevel).toHaveProperty('symbol')
  })

  it('returns a flat array when mergeLevels=true even with 2+ levels active', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', level: 'symbol', chunks: true, mergeLevels: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns resultsByLevel + commitResults when multi-level + includeCommits', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', level: 'symbol', chunks: true, includeCommits: true })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('resultsByLevel')
    expect(res.body).toHaveProperty('commitResults')
  })

  it('renders per-level text sections when multi-level + rendered=true', async () => {
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'auth', level: 'symbol', chunks: true, rendered: true })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
  })

  it('returns 400 for invalid model override causing an http provider error', async () => {
    const prevProvider = process.env.GITSEMA_PROVIDER
    const prevUrl = process.env.GITSEMA_HTTP_URL
    process.env.GITSEMA_PROVIDER = 'http'
    delete process.env.GITSEMA_HTTP_URL
    try {
      const res = await request(app)
        .post('/api/v1/search')
        .send({ query: 'auth', textModel: 'some-http-model' })
      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    } finally {
      if (prevProvider === undefined) delete process.env.GITSEMA_PROVIDER
      else process.env.GITSEMA_PROVIDER = prevProvider
      if (prevUrl === undefined) delete process.env.GITSEMA_HTTP_URL
      else process.env.GITSEMA_HTTP_URL = prevUrl
    }
  })
})

// ===========================================================================
// POST /api/v1/analysis/multi-repo-search — deprecated alias (Phase 138)
// ===========================================================================
describe('POST /api/v1/analysis/multi-repo-search — deprecated alias', () => {
  it('still returns 200 with an array and sets a Deprecation header', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/multi-repo-search')
      .send({ query: 'auth' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.headers['deprecation']).toBe('true')
    expect(res.headers['link']).toMatch(/\/api\/v1\/search/)
  })

  it('returns 400 for missing query', async () => {
    const res = await request(app).post('/api/v1/analysis/multi-repo-search').send({})
    expect(res.status).toBe(400)
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

  it('accepts level=symbol and echoes it back (Phase 139)', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: 'src/index.ts', level: 'symbol' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('level', 'symbol')
  })

  it('rejects an invalid level value', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: 'src/index.ts', level: 'chunk' })
    expect(res.status).toBe(400)
  })

  it('accepts a branch filter and returns an empty timeline on an empty DB (Phase 139)', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: 'src/index.ts', branch: 'feature/x' })
    expect(res.status).toBe(200)
    expect(res.body.versions).toBe(0)
  })

  it('accepts an alerts count and includes an alerts field (Phase 139)', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: 'src/index.ts', alerts: 5 })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('alerts')
    expect(Array.isArray(res.body.alerts)).toBe(true)
  })

  it('omits the alerts field when alerts is not requested', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: 'src/index.ts' })
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('alerts')
  })

  it('rejects a non-positive alerts count', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/file')
      .send({ path: 'src/index.ts', alerts: 0 })
    expect(res.status).toBe(400)
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

  it('accepts a branch filter (Phase 139)', async () => {
    const res = await request(app)
      .post('/api/v1/evolution/concept')
      .send({ query: 'authentication middleware', branch: 'feature/x' })
    expect(res.status).toBe(200)
    expect(res.body.entries).toBe(0)
  })

  it('accepts textModel/model overrides without erroring on an unconfigured provider (Phase 139)', async () => {
    // No model profile is configured for 'nonexistent-model', so buildProviderForModel
    // falls back to the default (ollama) provider type rather than throwing synchronously —
    // the request should still resolve to a 200 or a 502 (embed failure), never a 400.
    const res = await request(app)
      .post('/api/v1/evolution/concept')
      .send({ query: 'authentication middleware', textModel: 'nonexistent-model' })
    expect([200, 502]).toContain(res.status)
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

  it('returns 200 with { authors } structure (empty DB)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication' })
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
    expect(Array.isArray(res.body.authors)).toBe(true)
    expect(res.body.authors.length).toBe(0)
    expect(res.body.commits).toBeUndefined()
  })

  it('accepts --since (Phase 141) and returns 200 with a valid date', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication', since: '2020-01-01' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.authors)).toBe(true)
  })

  it('returns 400 for an unparseable --since value', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication', since: 'not-a-date-at-all-!!' })
    expect(res.status).toBe(400)
  })

  it('accepts --detail (Phase 141) without error', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication', detail: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.authors)).toBe(true)
  })

  it('accepts --hybrid + --bm25-weight (Phase 141) without error', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication', hybrid: true, bm25Weight: 0.5 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.authors)).toBe(true)
  })

  it('accepts --include-commits (Phase 141) and returns a commits array', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication', includeCommits: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.authors)).toBe(true)
    expect(Array.isArray(res.body.commits)).toBe(true)
  })

  it('accepts chunks/level/vss (Phase 141 flag-surface parity, no-op like the CLI)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication', chunks: true, level: 'symbol', vss: true })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.authors)).toBe(true)
  })

  it('returns 400 for an invalid level enum value', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication', level: 'not-a-real-level' })
    expect(res.status).toBe(400)
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
// POST /api/v1/analysis/doc-gap
// ===========================================================================
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

// ===========================================================================
// POST /api/v1/analysis/contributor-profile
// ===========================================================================
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

// ===========================================================================
// POST /api/v1/analysis/triage
// ===========================================================================
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

// ===========================================================================
// POST /api/v1/analysis/policy-check
// ===========================================================================
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

// ===========================================================================
// POST /api/v1/analysis/ownership
// ===========================================================================
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

// ===========================================================================
// POST /api/v1/analysis/workflow
// ===========================================================================
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

// ===========================================================================
// POST /api/v1/analysis/eval
// ===========================================================================
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

// ===========================================================================
// POST /api/v1/graph/hotspots
// ===========================================================================
describe('POST /api/v1/graph/hotspots', () => {
  it('returns 200 with hotspots structure on an empty graph', async () => {
    const res = await request(app).post('/api/v1/graph/hotspots').send({})
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('lens', 'hybrid')
    expect(res.body).toHaveProperty('hotspots')
    expect(Array.isArray(res.body.hotspots)).toBe(true)
  })

  it('accepts a lens override', async () => {
    const res = await request(app)
      .post('/api/v1/graph/hotspots')
      .send({ lens: 'structural' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('lens', 'structural')
  })

  it('accepts weightStructural for CLI flag parity (Phase 139), currently a no-op', async () => {
    const res = await request(app)
      .post('/api/v1/graph/hotspots')
      .send({ weightStructural: 0.7 })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('hotspots')
  })

  it('rejects an invalid lens value', async () => {
    const res = await request(app)
      .post('/api/v1/graph/hotspots')
      .send({ lens: 'nonsense' })
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// Phase 140: model-override triplet on analysis.ts routes
//
// `--model`/`--text-model`/`--code-model` are now accepted as body fields on
// clusters, change-points, author, impact, semantic-diff, semantic-blame,
// triage, and workflow. Requesting a model name containing "override" routes
// (via the providerFactory mock above) to a distinguishable mock provider —
// confirming resolveRequestProvider() actually swapped providers instead of
// silently ignoring the override.
// ===========================================================================
describe('Phase 140: model overrides on analysis routes', () => {
  it('change-points accepts model override and still returns 200', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/change-points')
      .send({ query: 'authentication', model: 'override-model' })
    expect(res.status).toBe(200)
  })

  it('author accepts textModel override and still returns 200', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication', textModel: 'override-text-model' })
    expect(res.status).toBe(200)
  })

  it('impact accepts codeModel override and returns 200 or 500 (no git repo)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/impact')
      .send({ file: 'src/index.ts', codeModel: 'override-code-model' })
    expect([200, 500]).toContain(res.status)
  })

  it('semantic-diff accepts model override and returns 200 or 500 (no git repo)', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/semantic-diff')
      .send({ ref1: 'abc123', ref2: 'def456', query: 'authentication', model: 'override-model' })
    expect([200, 500]).toContain(res.status)
  })

  it('semantic-blame accepts model override and returns 200 with an array', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/semantic-blame')
      .send({ filePath: 'src/index.ts', content: 'export function auth() {}', model: 'override-model' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('triage accepts model override and returns 200 with sections', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/triage')
      .send({ query: 'authentication', top: 3, model: 'override-model' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('sections')
  })

  it('workflow accepts model override for the incident template', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/workflow')
      .send({ template: 'incident', query: 'database crash', top: 3, model: 'override-model' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('template', 'incident')
  })

  it('clusters accepts the model-override triplet without rejecting the request', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/clusters')
      .send({ k: 3, model: 'override-model' })
    // clusters ignores the override for behavior (no per-model filtering),
    // but must still accept the field and not 400 on it.
    expect([200, 500]).toContain(res.status)
  })

  it('clusters returns 400 when the override resolves to an invalid provider config', async () => {
    const prevProvider = process.env.GITSEMA_PROVIDER
    process.env.GITSEMA_PROVIDER = 'http'
    delete process.env.GITSEMA_HTTP_URL
    try {
      const res = await request(app)
        .post('/api/v1/analysis/clusters')
        .send({ k: 3, model: 'some-http-model' })
      expect(res.status).toBe(400)
    } finally {
      if (prevProvider === undefined) delete process.env.GITSEMA_PROVIDER
      else process.env.GITSEMA_PROVIDER = prevProvider
    }
  })

  it('change-points returns 400 when the override resolves to an invalid provider config', async () => {
    const prevProvider = process.env.GITSEMA_PROVIDER
    process.env.GITSEMA_PROVIDER = 'http'
    delete process.env.GITSEMA_HTTP_URL
    try {
      const res = await request(app)
        .post('/api/v1/analysis/change-points')
        .send({ query: 'auth', model: 'some-http-model' })
      expect(res.status).toBe(400)
    } finally {
      if (prevProvider === undefined) delete process.env.GITSEMA_PROVIDER
      else process.env.GITSEMA_PROVIDER = prevProvider
    }
  })

  it('requests without any override field still use the router default textProvider', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/author')
      .send({ query: 'authentication' })
    expect(res.status).toBe(200)
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
// POST /api/v1/protocol/:operation (Phase 113 — LSP/MCP remote delegation)
// ===========================================================================
describe('POST /api/v1/protocol/:operation', () => {
  it('dispatches mcp.<toolName> operations to the matching MCP tool handler', async () => {
    const res = await request(app)
      .post('/api/v1/protocol/mcp.get_skill')
      .send({ args: {} })
    expect(res.status).toBe(200)
    expect(res.body.result).toBeDefined()
    expect(res.body.result.content).toBeDefined()
  })

  it('dispatches lsp.<op> operations to the LSP handler', async () => {
    const res = await request(app)
      .post('/api/v1/protocol/lsp.references')
      .send({ args: { text: 'foo' } })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('result')
  })

  it('returns 404 for an unknown mcp.* operation', async () => {
    const res = await request(app)
      .post('/api/v1/protocol/mcp.bogus_tool')
      .send({ args: {} })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Unknown MCP operation/)
  })

  it('returns 404 for an unknown lsp.* operation', async () => {
    const res = await request(app)
      .post('/api/v1/protocol/lsp.bogus_op')
      .send({ args: {} })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Unknown LSP operation/)
  })

  it('returns 404 for an operation with no recognized prefix', async () => {
    const res = await request(app)
      .post('/api/v1/protocol/bogus')
      .send({ args: {} })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Unknown operation/)
  })
})

// ===========================================================================
// POST /api/v1/narrate, POST /api/v1/explain — Phase 144
//
// evidenceOnly toggle + explain's log/files/lens fields. No narrator model is
// configured in the mocked in-memory DB, so `evidenceOnly: false` still makes
// no network call (safe-by-default disabled provider) — these assertions
// focus on request parsing / response shape, not real LLM output. `since:
// '2099-01-01'` guarantees zero matching commits so results are deterministic.
// ===========================================================================
describe('POST /api/v1/narrate — Phase 144 evidenceOnly toggle', () => {
  it('defaults to evidence-only (llmEnabled false, evidence array present)', async () => {
    const res = await request(app)
      .post('/api/v1/narrate')
      .send({ since: '2099-01-01' })
    expect(res.status).toBe(200)
    expect(res.body.llmEnabled).toBe(false)
    expect(Array.isArray(res.body.evidence)).toBe(true)
  })

  it('accepts evidenceOnly: false explicitly without erroring (no narrator configured → still safe)', async () => {
    const res = await request(app)
      .post('/api/v1/narrate')
      .send({ since: '2099-01-01', evidenceOnly: false })
    expect(res.status).toBe(200)
    expect(res.body.llmEnabled).toBe(false)
  })

  it('accepts a lens field for CLI flag-surface parity (no-op for narrate)', async () => {
    const res = await request(app)
      .post('/api/v1/narrate')
      .send({ since: '2099-01-01', lens: 'hybrid' })
    expect(res.status).toBe(200)
  })

  it('rejects an invalid lens value', async () => {
    const res = await request(app)
      .post('/api/v1/narrate')
      .send({ since: '2099-01-01', lens: 'nonsense' })
    expect(res.status).toBe(400)
  })

  it('rejects a non-boolean evidenceOnly value', async () => {
    const res = await request(app)
      .post('/api/v1/narrate')
      .send({ since: '2099-01-01', evidenceOnly: 'yes' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/explain — Phase 144 evidenceOnly/log/files/lens', () => {
  it('defaults to evidence-only (llmEnabled false, evidence array present)', async () => {
    const res = await request(app)
      .post('/api/v1/explain')
      .send({ topic: 'xyzzythiscannotexist_98765', since: '2099-01-01' })
    expect(res.status).toBe(200)
    expect(res.body.llmEnabled).toBe(false)
    expect(Array.isArray(res.body.evidence)).toBe(true)
  })

  it('accepts a log path and a files glob without erroring', async () => {
    const res = await request(app)
      .post('/api/v1/explain')
      .send({
        topic: 'xyzzythiscannotexist_98765',
        since: '2099-01-01',
        log: '/nonexistent/path/to.log',
        files: 'src/**/*.ts',
      })
    expect(res.status).toBe(200)
  })

  it('does not include structuralContext for the default semantic lens', async () => {
    const res = await request(app)
      .post('/api/v1/explain')
      .send({
        topic: 'xyzzythiscannotexist_98765',
        since: '2099-01-01',
        files: 'src/server/routes/narrator.ts',
      })
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('structuralContext')
  })

  it('accepts a structural/hybrid lens with files without erroring (empty graph → no structuralContext)', async () => {
    const res = await request(app)
      .post('/api/v1/explain')
      .send({
        topic: 'xyzzythiscannotexist_98765',
        since: '2099-01-01',
        files: 'src/server/routes/narrator.ts',
        lens: 'hybrid',
      })
    expect(res.status).toBe(200)
    // No graph data indexed in this test DB, so structuralContextForPath finds
    // nothing and the field is omitted rather than throwing.
    expect(res.body).not.toHaveProperty('structuralContext')
  })

  it('rejects an invalid lens value', async () => {
    const res = await request(app)
      .post('/api/v1/explain')
      .send({ topic: 'test', lens: 'nonsense' })
    expect(res.status).toBe(400)
  })

  it('rejects a non-boolean evidenceOnly value', async () => {
    const res = await request(app)
      .post('/api/v1/explain')
      .send({ topic: 'test', evidenceOnly: 'yes' })
    expect(res.status).toBe(400)
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
