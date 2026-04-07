import { describe, it, expect, vi, afterEach } from 'vitest'

// ── Shared mocks ──────────────────────────────────────────────────────────
vi.mock('../src/core/indexing/blobStore.js', () => ({
  getBlobContent: vi.fn().mockReturnValue('const foo = 1;\nconst bar = 2;'),
  storeBlob: vi.fn(),
  storeBlobRecord: vi.fn(),
  storeChunk: vi.fn(),
  storeCommitWithBlobs: vi.fn().mockReturnValue(1),
  markCommitIndexed: vi.fn(),
  getLastIndexedCommit: vi.fn().mockReturnValue(undefined),
  storeBlobBranches: vi.fn(),
  storeCommitEmbedding: vi.fn(),
  storeModuleEmbedding: vi.fn(),
  getModuleEmbedding: vi.fn().mockReturnValue(null),
  storeFtsContent: vi.fn(),
  storeSymbol: vi.fn().mockReturnValue(1),
}))

vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: vi.fn().mockReturnValue({
    db: { select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([]) },
    rawDb: { prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(undefined), run: vi.fn() }) },
  }),
  initDb: vi.fn().mockReturnValue({ db: {}, rawDb: {} }),
  getRawDb: vi.fn().mockReturnValue({ prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(undefined), run: vi.fn() }) }),
}))

import { formatExplainForLlm } from '../src/core/search/explainFormatter.js'
import type { SearchResult } from '../src/core/models/types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const makeResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  blobHash: 'abc1234def5678901234567890',
  paths: ['src/foo.ts'],
  score: 0.847,
  firstSeen: 1700000000,
  ...overrides,
})

describe('formatExplainForLlm', () => {
  it('returns (No results.) for empty input', () => {
    expect(formatExplainForLlm([])).toBe('(No results.)')
  })

  it('contains citation header and score', () => {
    const output = formatExplainForLlm([makeResult()])
    expect(output).toContain('## [1] src/foo.ts')
    expect(output).toContain('score=0.8470')
  })

  it('includes blob hash (7 chars)', () => {
    const output = formatExplainForLlm([makeResult()])
    expect(output).toContain('Blob: abc1234')
  })

  it('includes first-seen date', () => {
    const output = formatExplainForLlm([makeResult()])
    expect(output).toContain('First seen:')
    expect(output).toContain('2023-11-14')
  })

  it('includes signals when present', () => {
    const result = makeResult({ signals: { cosine: 0.921, recency: 0.712, pathScore: 0.45 } })
    const output = formatExplainForLlm([result])
    expect(output).toContain('cosine=0.9210')
    expect(output).toContain('recency=0.7120')
  })

  it('falls back to score when signals are absent', () => {
    const output = formatExplainForLlm([makeResult()])
    expect(output).toContain('Signals: cosine=0.8470')
  })

  it('includes content snippet', () => {
    const output = formatExplainForLlm([makeResult()])
    expect(output).toContain('Snippet:')
    expect(output).toContain('const foo')
  })

  it('skips snippet when includeSnippet=false', () => {
    const output = formatExplainForLlm([makeResult()], { includeSnippet: false })
    expect(output).not.toContain('Snippet:')
  })

  it('numbers multiple results', () => {
    const output = formatExplainForLlm([makeResult(), makeResult({ paths: ['src/bar.ts'] })])
    expect(output).toContain('## [1]')
    expect(output).toContain('## [2]')
  })

  it('shows also-known-as when multiple paths', () => {
    const result = makeResult({ paths: ['src/foo.ts', 'legacy/old.ts'] })
    const output = formatExplainForLlm([result])
    expect(output).toContain('Also known as: legacy/old.ts')
  })
})

// ── Capabilities endpoint test ─────────────────────────────────────────────
import { createApp } from '../src/server/app.js'
import request from 'supertest'

const mockProvider = {
  embed: vi.fn().mockResolvedValue(new Float32Array(4)),
  embedBatch: vi.fn().mockResolvedValue([new Float32Array(4)]),
  dimensions: 4,
  model: 'test-model',
}

describe('GET /api/v1/capabilities', () => {
  it('returns capabilities JSON with features and version', async () => {
    const app = createApp({ textProvider: mockProvider })
    const res = await request(app).get('/api/v1/capabilities')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('version')
    expect(res.body).toHaveProperty('features')
    expect(Array.isArray(res.body.features)).toBe(true)
    expect(res.body.features).toContain('semantic_search')
    expect(res.body.features).toContain('early_cut')
    expect(res.body).toHaveProperty('providers')
  })
})
