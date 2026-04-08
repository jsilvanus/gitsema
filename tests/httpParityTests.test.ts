/**
 * HTTP API parity tests — INTENTIONALLY FAILING.
 *
 * These tests assert that every CLI/MCP analysis command also has an HTTP route.
 * Per docs/review5.md §3 ("Missing HTTP Routes"), the following routes are called
 * out as absent even though the CLI commands and (for some) MCP tools exist.
 *
 * If the route is missing the test will fail with a 404, which is the intended
 * signal to implementors. Do NOT change these to `it.skip` — the failures are
 * the mechanism that keeps CI red until parity is achieved.
 *
 * Routes under test (all POST /api/v1/analysis/…):
 *   doc-gap            — gitsema doc-gap
 *   contributor-profile — gitsema contributor-profile
 *   triage             — gitsema triage <query>
 *   policy-check       — gitsema policy check
 *   ownership          — gitsema ownership <query>
 *   workflow           — gitsema workflow run <template>
 *   eval               — gitsema eval
 *
 * See docs/review5.md §3 for the full parity table.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import { createApp } from '../src/server/app.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

// ---------------------------------------------------------------------------
// Mock embedding provider — deterministic, no network required
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
  const session = openDatabaseAt(':memory:')
  ;(globalThis as any).__gitsemaTestSession = session
  app = createApp({ textProvider: mockProvider })
})

afterAll(() => {
  delete (globalThis as any).__gitsemaTestSession
})

// ---------------------------------------------------------------------------
// Helper: assert a route exists and returns 200
// Routes that are not yet implemented will return 404 and the test will FAIL.
// The failure message identifies exactly which parity gap needs to be closed.
// ---------------------------------------------------------------------------
function assertRouteExists(
  method: 'post' | 'get',
  path: string,
  body: Record<string, unknown> = {},
) {
  return async () => {
    const req = method === 'post'
      ? request(app).post(path).send(body)
      : request(app).get(path)
    const res = await req
    expect(
      res.status,
      `HTTP route ${method.toUpperCase()} ${path} is not implemented (got ${res.status}). ` +
      `Add this route to src/server/routes/analysis.ts to close the parity gap. ` +
      `See docs/review5.md §3 for details.`,
    ).toBe(200)
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/doc-gap
// CLI: gitsema doc-gap
// MCP: ❌ missing (review5.md §3)
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/doc-gap [PARITY GAP]', () => {
  it(
    'returns 200 with doc-gap results array — FAILS until route is implemented',
    assertRouteExists('post', '/api/v1/analysis/doc-gap', { topK: 5 }),
  )

  it('response has expected shape: array of { blobHash, paths, maxDocSimilarity }', async () => {
    // This test documents the expected response contract for implementors.
    // While the route is missing it also fails at the status check below,
    // giving a second actionable failure message.
    const res = await request(app)
      .post('/api/v1/analysis/doc-gap')
      .send({ topK: 5 })
    expect(res.status, 'Route /api/v1/analysis/doc-gap not implemented').toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('blobHash')
      expect(res.body[0]).toHaveProperty('paths')
      expect(res.body[0]).toHaveProperty('maxDocSimilarity')
    }
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/contributor-profile
// CLI: gitsema contributor-profile <author>
// MCP: ❌ missing (review5.md §3)
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/contributor-profile [PARITY GAP]', () => {
  it(
    'returns 200 with contributor profile — FAILS until route is implemented',
    assertRouteExists('post', '/api/v1/analysis/contributor-profile', { author: 'alice' }),
  )

  it('returns 400 when author field is missing', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/contributor-profile')
      .send({})
    // If the route doesn't exist it returns 404, not 400.
    // Either way this assertion documents the expected contract.
    // TODO: tighten to expect only 400 once the route is implemented.
    expect(
      [400, 404].includes(res.status),
      `Expected 400 (validation error) or 404 (missing route) but got ${res.status}`,
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/triage
// CLI: gitsema triage <query>
// MCP: ❌ missing (review5.md §3)
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/triage [PARITY GAP]', () => {
  it(
    'returns 200 with triage bundle — FAILS until route is implemented',
    assertRouteExists('post', '/api/v1/analysis/triage', { query: 'authentication bug' }),
  )

  it('returns 400 for missing query field', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/triage')
      .send({})
    // TODO: tighten to expect only 400 once the route is implemented.
    expect(
      [400, 404].includes(res.status),
      `Expected 400 (validation) or 404 (missing route) but got ${res.status}`,
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/policy-check
// CLI: gitsema policy check
// MCP: ❌ missing (review5.md §3)
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/policy-check [PARITY GAP]', () => {
  it(
    'returns 200 with policy check results — FAILS until route is implemented',
    assertRouteExists('post', '/api/v1/analysis/policy-check', { maxDebtScore: '0.8' }),
  )

  it('response has expected shape: { passed, checks }', async () => {
    // This test documents the expected response contract for implementors.
    // While the route is missing it also fails at the status check below.
    const res = await request(app)
      .post('/api/v1/analysis/policy-check')
      .send({ maxDebtScore: '0.8' })
    expect(res.status, 'Route /api/v1/analysis/policy-check not implemented').toBe(200)
    expect(res.body).toHaveProperty('passed')
    expect(res.body).toHaveProperty('checks')
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/ownership
// CLI: gitsema ownership <query>
// MCP: ❌ missing (review5.md §3)
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/ownership [PARITY GAP]', () => {
  it(
    'returns 200 with ownership heatmap — FAILS until route is implemented',
    assertRouteExists('post', '/api/v1/analysis/ownership', { query: 'auth middleware' }),
  )

  it('returns 400 for missing query field', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/ownership')
      .send({})
    // TODO: tighten to expect only 400 once the route is implemented.
    expect(
      [400, 404].includes(res.status),
      `Expected 400 or 404 but got ${res.status}`,
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/workflow
// CLI: gitsema workflow run <template>
// MCP: ❌ missing (review5.md §3)
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/workflow [PARITY GAP]', () => {
  it(
    'returns 200 with workflow output — FAILS until route is implemented',
    assertRouteExists('post', '/api/v1/analysis/workflow', { template: 'release-audit' }),
  )

  it('returns 400 for unknown template', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/workflow')
      .send({ template: 'not-a-real-template' })
    // TODO: tighten to expect only 400 once the route is implemented.
    expect(
      [400, 404].includes(res.status),
      `Expected 400 or 404 but got ${res.status}`,
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/analysis/eval
// CLI: gitsema eval
// MCP: ❌ missing (review5.md §3)
// ---------------------------------------------------------------------------
describe('POST /api/v1/analysis/eval [PARITY GAP]', () => {
  it(
    'returns 200 with eval results — FAILS until route is implemented',
    assertRouteExists('post', '/api/v1/analysis/eval', {
      cases: [{ query: 'authentication', expectedPaths: ['src/auth.ts'] }],
    }),
  )

  it('returns 400 when cases array is missing', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/eval')
      .send({})
    // TODO: tighten to expect only 400 once the route is implemented.
    expect(
      [400, 404].includes(res.status),
      `Expected 400 or 404 but got ${res.status}`,
    ).toBe(true)
  })
})
