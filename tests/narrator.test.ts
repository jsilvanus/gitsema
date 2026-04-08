/**
 * Tests for src/core/llm/narrator.ts
 *
 * Uses vi.stubGlobal to mock the global `fetch` so no real HTTP calls are made.
 * Verifies prompt construction, response parsing, and graceful error fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  narrateEvolution,
  narrateClusters,
  narrateSecurityFindings,
  narrateSearchResults,
  narrateChangePoints,
} from '../src/core/llm/narrator.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(responseBody: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(responseBody)),
    json: vi.fn().mockResolvedValue(responseBody),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function cannedCompletion(text: string) {
  return {
    choices: [{ message: { content: text } }],
  }
}

function minimalEvolutionEntries() {
  return [
    { blobHash: 'abc', commitHash: 'c1', timestamp: 1000000, distFromPrev: 0, distFromOrigin: 0, score: 0.9, paths: ['src/a.ts'] },
    { blobHash: 'def', commitHash: 'c2', timestamp: 2000000, distFromPrev: 0.4, distFromOrigin: 0.4, score: 0.7, paths: ['src/a.ts'] },
  ]
}

// ---------------------------------------------------------------------------
// Environment management
// ---------------------------------------------------------------------------

const OLD_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
  OLD_ENV['GITSEMA_LLM_URL'] = process.env.GITSEMA_LLM_URL
  OLD_ENV['GITSEMA_LLM_MODEL'] = process.env.GITSEMA_LLM_MODEL
  OLD_ENV['GITSEMA_API_KEY'] = process.env.GITSEMA_API_KEY
  delete process.env.GITSEMA_LLM_URL
  delete process.env.GITSEMA_LLM_MODEL
  delete process.env.GITSEMA_API_KEY
})

afterEach(() => {
  for (const [k, v] of Object.entries(OLD_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// narrateEvolution
// ---------------------------------------------------------------------------

describe('narrateEvolution', () => {
  it('returns unavailable message when GITSEMA_LLM_URL is not set', async () => {
    const result = await narrateEvolution('src/auth.ts', [], 0.3)
    expect(result).toContain('LLM narration unavailable')
    expect(result).toContain('GITSEMA_LLM_URL')
  })

  it('returns error when GITSEMA_LLM_URL is not a valid URL', async () => {
    process.env.GITSEMA_LLM_URL = 'not-a-url'
    const result = await narrateEvolution('src/auth.ts', [], 0.3)
    expect(result).toContain('LLM narration unavailable')
  })

  it('returns error when GITSEMA_LLM_URL uses unsupported protocol', async () => {
    process.env.GITSEMA_LLM_URL = 'ftp://example.com'
    const result = await narrateEvolution('src/auth.ts', [], 0.3)
    expect(result).toContain('LLM narration unavailable')
    expect(result).toContain('http or https')
  })

  it('calls the correct chat completions endpoint', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    const fetchMock = mockFetch(cannedCompletion('The file evolved significantly.'))

    await narrateEvolution('src/auth.ts', minimalEvolutionEntries(), 0.3)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('sends a Bearer token when GITSEMA_API_KEY is set', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    process.env.GITSEMA_API_KEY = 'sk-test'
    const fetchMock = mockFetch(cannedCompletion('Summary.'))

    await narrateEvolution('src/auth.ts', minimalEvolutionEntries(), 0.3)

    const [, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-test')
  })

  it('returns the LLM response text', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    mockFetch(cannedCompletion('Key shift at 2001-09-09.'))

    const result = await narrateEvolution('src/auth.ts', minimalEvolutionEntries(), 0.3)
    expect(result).toBe('Key shift at 2001-09-09.')
  })

  it('includes file path in prompt', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    const fetchMock = mockFetch(cannedCompletion('ok'))

    await narrateEvolution('src/special/auth.ts', minimalEvolutionEntries(), 0.3)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.messages[0].content).toContain('src/special/auth.ts')
  })

  it('falls back gracefully on HTTP error', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    mockFetch({ error: { message: 'unauthorized' } }, 401)

    const result = await narrateEvolution('src/auth.ts', minimalEvolutionEntries(), 0.3)
    expect(result).toContain('LLM narration failed')
  })

  it('falls back gracefully when response has no choices', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    mockFetch({ choices: [] })

    const result = await narrateEvolution('src/auth.ts', minimalEvolutionEntries(), 0.3)
    expect(result).toContain('LLM narration failed')
  })

  it('uses custom model name when GITSEMA_LLM_MODEL is set', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    process.env.GITSEMA_LLM_MODEL = 'llama3'
    const fetchMock = mockFetch(cannedCompletion('ok'))

    await narrateEvolution('src/auth.ts', minimalEvolutionEntries(), 0.3)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('llama3')
  })
})

// ---------------------------------------------------------------------------
// narrateClusters
// ---------------------------------------------------------------------------

describe('narrateClusters', () => {
  const report = {
    clusters: [
      { id: 0, label: 'auth', size: 10, topKeywords: ['token', 'user', 'auth'], representativePaths: ['src/auth.ts'], centroid: [] },
      { id: 1, label: 'db', size: 5, topKeywords: ['query', 'db'], representativePaths: ['src/db.ts'], centroid: [] },
    ],
    totalBlobs: 15,
    ref: 'HEAD',
    timestamp: 0,
    edgeCount: 1,
    edges: [],
  }

  it('returns unavailable message when URL is missing', async () => {
    const result = await narrateClusters(report)
    expect(result).toContain('LLM narration unavailable')
  })

  it('returns cluster summary from LLM', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    mockFetch(cannedCompletion('Codebase has 2 main clusters: auth and db.'))

    const result = await narrateClusters(report)
    expect(result).toBe('Codebase has 2 main clusters: auth and db.')
  })

  it('includes cluster count in prompt', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    const fetchMock = mockFetch(cannedCompletion('ok'))

    await narrateClusters(report)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.messages[0].content).toContain('2 clusters')
  })
})

// ---------------------------------------------------------------------------
// narrateSecurityFindings
// ---------------------------------------------------------------------------

describe('narrateSecurityFindings', () => {
  const findings = [
    { patternName: 'hardcoded-secret', confidence: 'high' as const, score: 0.9, blobHash: 'abc123', paths: ['src/config.ts'], heuristicMatches: [] },
    { patternName: 'sql-injection', confidence: 'medium' as const, score: 0.7, blobHash: 'def456', paths: ['src/db.ts'], heuristicMatches: [] },
  ]

  it('returns unavailable message when URL is missing', async () => {
    const result = await narrateSecurityFindings(findings)
    expect(result).toContain('LLM narration unavailable')
  })

  it('returns security triage summary', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    mockFetch(cannedCompletion('1 high-confidence and 1 medium-confidence finding.'))

    const result = await narrateSecurityFindings(findings)
    expect(result).toBe('1 high-confidence and 1 medium-confidence finding.')
  })
})

// ---------------------------------------------------------------------------
// narrateSearchResults
// ---------------------------------------------------------------------------

describe('narrateSearchResults', () => {
  const results = [
    { blobHash: 'a1', score: 0.95, paths: ['src/auth.ts'], firstSeen: 1000000 },
    { blobHash: 'a2', score: 0.85, paths: ['src/middleware.ts'], firstSeen: 2000000 },
  ]

  it('returns unavailable message when URL is missing', async () => {
    const result = await narrateSearchResults('authentication', results)
    expect(result).toContain('LLM narration unavailable')
  })

  it('includes query in prompt', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    const fetchMock = mockFetch(cannedCompletion('Auth code found.'))

    await narrateSearchResults('authentication middleware', results)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.messages[0].content).toContain('authentication middleware')
  })
})

// ---------------------------------------------------------------------------
// narrateChangePoints
// ---------------------------------------------------------------------------

describe('narrateChangePoints', () => {
  const report = {
    type: 'concept-change-points' as const,
    query: 'authentication',
    k: 10,
    threshold: 0.3,
    range: { since: null, until: null },
    points: [
      {
        before: { commit: 'c0', date: '2023-01-01', timestamp: 1000000, topPaths: ['src/old.ts'] },
        after:  { commit: 'c1', date: '2023-06-01', timestamp: 2000000, topPaths: ['src/auth.ts'] },
        distance: 0.42,
      },
    ],
  }

  it('returns unavailable message when URL is missing', async () => {
    const result = await narrateChangePoints(report)
    expect(result).toContain('LLM narration unavailable')
  })

  it('returns change-points narrative', async () => {
    process.env.GITSEMA_LLM_URL = 'http://localhost:11434'
    mockFetch(cannedCompletion('One major shift in auth detected.'))

    const result = await narrateChangePoints(report)
    expect(result).toBe('One major shift in auth detected.')
  })
})
