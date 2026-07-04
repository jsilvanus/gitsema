/**
 * HTTP integration tests for POST /api/v1/guide/chat, focused on the Phase
 * 145 `lens` schema addition — verifies the route accepts `lens`, validates
 * its enum, and forwards a lens-hint-suffixed question to `runGuide` that
 * matches CLI `guide --lens`'s `withLens()` behavior byte-for-byte (see
 * src/cli/commands/guide.ts and src/server/routes/guide.ts).
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import request from 'supertest'

// Mock sqlite DB module to return an in-memory session for all imports.
vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  const session = actual.openDatabaseAt(':memory:')
  return {
    ...actual,
    getActiveSession: () => session,
    db: session.db,
  }
})

// Mock runGuide so we can assert exactly what question string the route
// forwards to it, without needing a real narrator/guide model configured.
const runGuideMock = vi.fn(async (question: string) => ({
  answer: `echo: ${question}`,
  contextUsed: false,
  llmEnabled: false,
}))

vi.mock('../src/cli/commands/guide.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cli/commands/guide.js')>()
  return {
    ...actual,
    runGuide: (...args: Parameters<typeof runGuideMock>) => runGuideMock(...args),
  }
})

import { createApp } from '../src/server/app.js'
import { ByokUrlValidationError } from '../src/core/narrator/resolveNarrator.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
const mockProvider: EmbeddingProvider = {
  model: 'mock',
  embed: async () => [...MOCK_VEC],
  embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
  dimensions: 4,
}

let app: ReturnType<typeof createApp>

beforeAll(() => {
  app = createApp({ textProvider: mockProvider })
})

afterEach(() => {
  runGuideMock.mockClear()
  delete process.env.GITSEMA_SERVE_KEY
})

describe('POST /api/v1/guide/chat — lens (Phase 145)', () => {
  it('defaults to semantic lens: question forwarded unchanged', async () => {
    const res = await request(app)
      .post('/api/v1/guide/chat')
      .send({ question: 'what does the indexer do?' })

    expect(res.status).toBe(200)
    expect(runGuideMock).toHaveBeenCalledTimes(1)
    const [forwardedQuestion] = runGuideMock.mock.calls[0]!
    expect(forwardedQuestion).toBe('what does the indexer do?')
  })

  it('structural lens appends the same hint suffix as the CLI', async () => {
    const res = await request(app)
      .post('/api/v1/guide/chat')
      .send({ question: 'what calls foo()?', lens: 'structural' })

    expect(res.status).toBe(200)
    const [forwardedQuestion] = runGuideMock.mock.calls[0]!
    expect(forwardedQuestion).toBe(
      'what calls foo()?\n\n(Lens preference: structural — prefer the structural tools call_graph, blast_radius, and hotspots where relevant.)',
    )
  })

  it('hybrid lens appends the hybrid hint suffix', async () => {
    await request(app)
      .post('/api/v1/guide/chat')
      .send({ question: 'blast radius of auth.ts', lens: 'hybrid' })

    const [forwardedQuestion] = runGuideMock.mock.calls[0]!
    expect(forwardedQuestion).toBe(
      'blast radius of auth.ts\n\n(Lens preference: hybrid — prefer the structural tools call_graph, blast_radius, and hotspots where relevant.)',
    )
  })

  it('rejects an invalid lens value with 400', async () => {
    const res = await request(app)
      .post('/api/v1/guide/chat')
      .send({ question: 'hi', lens: 'nonsense' })

    expect(res.status).toBe(400)
    expect(runGuideMock).not.toHaveBeenCalled()
  })

  it('returns 400 when BYOK validation rejects the supplied endpoint', async () => {
    runGuideMock.mockImplementationOnce(async () => {
      throw new ByokUrlValidationError('BYOK URL resolves to a blocked host: localhost')
    })

    const res = await request(app)
      .post('/api/v1/guide/chat')
      .send({ question: 'hi', byok: { http_url: 'http://localhost:9999' } })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('blocked host')
  })
})
