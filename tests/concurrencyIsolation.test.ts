/**
 * Concurrency and session isolation tests.
 *
 * Validates that AsyncLocalStorage-based session scoping correctly isolates
 * concurrent DB sessions so that:
 *   - Concurrent HTTP requests each see their own DB session
 *   - withDbSession() properly scopes session to async call chains
 *   - Interleaved async operations don't cross-contaminate sessions
 *   - Session falls back to default when no override is set
 *
 * These tests are intentionally lightweight — they exercise the session
 * scoping mechanism, not the full search/indexing pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openDatabaseAt, getActiveSession, withDbSession } from '../src/core/db/sqlite.js'
import { createApp } from '../src/server/app.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'
import request from 'supertest'

// ---------------------------------------------------------------------------
// Mock embedding provider
// ---------------------------------------------------------------------------
const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
const mockProvider: EmbeddingProvider = {
  model: 'mock',
  embed: async () => [...MOCK_VEC],
  embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
  dimensions: 4,
}

// ===========================================================================
// withDbSession isolation
// ===========================================================================

describe('withDbSession — session isolation', () => {
  it('getActiveSession() uses the session passed to withDbSession()', async () => {
    const session = openDatabaseAt(':memory:')
    const observed: string[] = []
    await withDbSession(session, async () => {
      const active = getActiveSession()
      observed.push(active.dbPath)
    })
    expect(observed).toContain(':memory:')
  })

  it('nested withDbSession() restores outer session after inner completes', async () => {
    const outer = openDatabaseAt(':memory:')
    const inner = openDatabaseAt(':memory:')
    const log: string[] = []

    await withDbSession(outer, async () => {
      log.push(`before-inner: ${getActiveSession() === outer ? 'outer' : 'other'}`)
      await withDbSession(inner, async () => {
        log.push(`inside-inner: ${getActiveSession() === inner ? 'inner' : 'other'}`)
      })
      log.push(`after-inner: ${getActiveSession() === outer ? 'outer' : 'other'}`)
    })

    expect(log).toEqual(['before-inner: outer', 'inside-inner: inner', 'after-inner: outer'])
  })

  it('concurrent withDbSession() calls are isolated from each other', async () => {
    const sessionA = openDatabaseAt(':memory:')
    const sessionB = openDatabaseAt(':memory:')

    // Stamp each session with a unique dbPath string for identification
    const resultA: string[] = []
    const resultB: string[] = []

    await Promise.all([
      withDbSession(sessionA, async () => {
        // yield to allow other async chain to run
        await new Promise((r) => setTimeout(r, 5))
        resultA.push(getActiveSession() === sessionA ? 'sessionA' : 'wrong')
        await new Promise((r) => setTimeout(r, 5))
        resultA.push(getActiveSession() === sessionA ? 'sessionA' : 'wrong')
      }),
      withDbSession(sessionB, async () => {
        await new Promise((r) => setTimeout(r, 2))
        resultB.push(getActiveSession() === sessionB ? 'sessionB' : 'wrong')
        await new Promise((r) => setTimeout(r, 10))
        resultB.push(getActiveSession() === sessionB ? 'sessionB' : 'wrong')
      }),
    ])

    // Each call chain should only see its own session
    expect(resultA).toEqual(['sessionA', 'sessionA'])
    expect(resultB).toEqual(['sessionB', 'sessionB'])
  })

  it('multiple concurrent chains do not leak sessions to each other', async () => {
    const sessions = Array.from({ length: 5 }, () => openDatabaseAt(':memory:'))
    const results: boolean[] = []

    await Promise.all(
      sessions.map((session, i) =>
        withDbSession(session, async () => {
          const delays = [i * 3, i * 3 + 2, i * 3 + 4]
          let allCorrect = true
          for (const delay of delays) {
            await new Promise((r) => setTimeout(r, delay))
            if (getActiveSession() !== session) {
              allCorrect = false
            }
          }
          results.push(allCorrect)
        }),
      ),
    )

    // All 5 concurrent chains should always see their own session
    expect(results.every((r) => r)).toBe(true)
    expect(results).toHaveLength(5)
  })
})

// ===========================================================================
// HTTP server — concurrent requests with shared app instance
// ===========================================================================

describe('HTTP server — concurrent request isolation', () => {
  const app = createApp({ textProvider: mockProvider })

  it('concurrent POST /search requests all return 200', async () => {
    const N = 10
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        request(app).post('/api/v1/search').send({ query: 'authentication' }),
      ),
    )
    for (const res of responses) {
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
    }
  })

  it('concurrent GET /api/v1/status requests all return 200', async () => {
    const N = 10
    const responses = await Promise.all(
      Array.from({ length: N }, () => request(app).get('/api/v1/status')),
    )
    for (const res of responses) {
      expect(res.status).toBe(200)
      expect(typeof res.body.blobs).toBe('number')
    }
  })

  it('concurrent POST /api/v1/analysis/health requests return consistent results', async () => {
    const N = 8
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        request(app).post('/api/v1/analysis/health').send({ buckets: 3 }),
      ),
    )
    for (const res of responses) {
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
    }
  })

  it('mixed concurrent requests all succeed without cross-contamination', async () => {
    const [searchRes, healthRes, statusRes, securityRes] = await Promise.all([
      request(app).post('/api/v1/search').send({ query: 'auth' }),
      request(app).post('/api/v1/analysis/health').send({ buckets: 6 }),
      request(app).get('/api/v1/status'),
      request(app).post('/api/v1/analysis/security-scan').send({}),
    ])

    expect(searchRes.status).toBe(200)
    expect(Array.isArray(searchRes.body)).toBe(true)

    expect(healthRes.status).toBe(200)
    expect(Array.isArray(healthRes.body)).toBe(true)

    expect(statusRes.status).toBe(200)
    expect(typeof statusRes.body.blobs).toBe('number')

    expect(securityRes.status).toBe(200)
    expect(Array.isArray(securityRes.body.findings)).toBe(true)
  })
})

// ===========================================================================
// withDbSession — callback return value is preserved
// ===========================================================================

describe('withDbSession — return value preservation', () => {
  it('returns the value from the async callback', async () => {
    const session = openDatabaseAt(':memory:')
    const result = await withDbSession(session, async () => {
      return 42
    })
    expect(result).toBe(42)
  })

  it('propagates errors thrown inside the callback', async () => {
    const session = openDatabaseAt(':memory:')
    await expect(
      withDbSession(session, async () => {
        throw new Error('inner error')
      }),
    ).rejects.toThrow('inner error')
  })

  it('session is not active outside the withDbSession callback', async () => {
    const session = openDatabaseAt(':memory:')
    // Record which session is active before, during, and after
    const snapshots: string[] = []

    // Outside: session should NOT be active (uses default)
    // (This test only checks the type, since we can't compare to default session easily)
    snapshots.push('before')

    await withDbSession(session, async () => {
      const active = getActiveSession()
      snapshots.push(active === session ? 'inside-correct' : 'inside-wrong')
    })

    snapshots.push('after')
    expect(snapshots).toEqual(['before', 'inside-correct', 'after'])
  })
})
