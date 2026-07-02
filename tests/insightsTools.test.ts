/**
 * Tests for Phase 148 "insights" core functions — the shared implementations
 * behind the CLI `regression-gate`/`code-review` commands, the new
 * `regression_gate`/`code_review`/`semantic_bisect`/`refactor_candidates`/
 * `concept_lifecycle`/`cherry_pick_suggest`/`file_diff` MCP tools, and the
 * new `POST /insights/*` HTTP routes.
 *
 * Uses a real in-memory SQLite DB and a mock embedding provider, following
 * the same pattern as tests/mcpTools.test.ts.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  const inMemorySession = actual.openDatabaseAt(':memory:')
  return {
    ...actual,
    getActiveSession: () => inMemorySession,
    db: inMemorySession.db,
  }
})

const MOCK_VEC = [0.1, 0.2, 0.3, 0.4]
vi.mock('../src/core/embedding/providerFactory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/embedding/providerFactory.js')>()
  const mockProvider = {
    model: 'mock',
    embed: async () => [...MOCK_VEC],
    embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
    dimensions: 4,
  }
  return {
    ...actual,
    getTextProvider: () => mockProvider,
    getCodeProvider: () => undefined,
    buildProvider: () => mockProvider,
  }
})

import { computeRegressionGate, type RegressionGateQuery } from '../src/core/search/regressionGate.js'
import { parseDiff, computeCodeReview } from '../src/core/search/codeReview.js'
import { computeSemanticBisect } from '../src/core/search/semanticBisect.js'
import { computeRefactorCandidates } from '../src/core/search/refactorCandidates.js'
import { computeConceptLifecycle } from '../src/core/search/conceptLifecycle.js'
import { suggestCherryPicks } from '../src/core/search/cherryPick.js'

const mockProvider = {
  model: 'mock',
  embed: async (_text: string) => [...MOCK_VEC],
  embedBatch: async (texts: string[]) => texts.map(() => [...MOCK_VEC]),
  dimensions: 4,
}

// ===========================================================================
// computeRegressionGate
// ===========================================================================
describe('computeRegressionGate', () => {
  it('passes with zero drift on an empty DB (both base/head scores are 0)', async () => {
    const queries: RegressionGateQuery[] = [
      { query: 'authentication flow', embedding: MOCK_VEC, threshold: 0.15 },
    ]
    const report = await computeRegressionGate(queries, { baseRef: 'main', headRef: 'HEAD', topK: 10 })
    expect(report.allPassed).toBe(true)
    expect(report.results).toHaveLength(1)
    expect(report.results[0]).toMatchObject({ query: 'authentication flow', baseScore: 0, headScore: 0, drift: 0, passed: true })
    expect(report.baseRef).toBe('main')
    expect(report.headRef).toBe('HEAD')
  })

  it('evaluates multiple queries independently with their own thresholds', async () => {
    const queries: RegressionGateQuery[] = [
      { query: 'a', embedding: MOCK_VEC, threshold: 0.1 },
      { query: 'b', embedding: MOCK_VEC, threshold: 0.5 },
    ]
    const report = await computeRegressionGate(queries, { baseRef: 'main', headRef: 'HEAD' })
    expect(report.results).toHaveLength(2)
    expect(report.results.map((r) => r.query)).toEqual(['a', 'b'])
    expect(report.allPassed).toBe(true)
  })

  it('reports allPassed=false when any result fails', async () => {
    // Empty DB always yields 0/0 scores (drift 0), so to exercise the
    // "failed" branch we pass a negative threshold, which no non-negative
    // drift can satisfy.
    const queries: RegressionGateQuery[] = [
      { query: 'x', embedding: MOCK_VEC, threshold: -1 },
    ]
    const report = await computeRegressionGate(queries, { baseRef: 'main', headRef: 'HEAD' })
    expect(report.results[0].passed).toBe(false)
    expect(report.allPassed).toBe(false)
  })
})

// ===========================================================================
// parseDiff
// ===========================================================================
describe('parseDiff', () => {
  it('parses a unified diff into per-file hunks with added/removed lines', () => {
    const diffText = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,3 @@',
      '-const x = 1',
      '+const x = 2',
      ' const y = 3',
    ].join('\n')
    const hunks = parseDiff(diffText)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].file).toBe('src/foo.ts')
    expect(hunks[0].addedLines).toEqual(['const x = 2'])
    expect(hunks[0].removedLines).toEqual(['const x = 1'])
  })

  it('returns an empty array for empty input', () => {
    expect(parseDiff('')).toEqual([])
  })

  it('handles multiple files in one diff', () => {
    const diffText = [
      'diff --git a/a.ts b/a.ts',
      '+added in a',
      'diff --git a/b.ts b/b.ts',
      '-removed from b',
    ].join('\n')
    const hunks = parseDiff(diffText)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].file).toBe('a.ts')
    expect(hunks[1].file).toBe('b.ts')
  })
})

// ===========================================================================
// computeCodeReview
// ===========================================================================
describe('computeCodeReview', () => {
  it('returns an empty analogues list on an empty DB (low regression risk)', async () => {
    const hunks = parseDiff('diff --git a/foo.ts b/foo.ts\n+function hello() {}\n')
    const reviews = await computeCodeReview(hunks, mockProvider, { topK: 5, threshold: 0.75 })
    expect(reviews).toHaveLength(1)
    expect(reviews[0].file).toBe('foo.ts')
    expect(reviews[0].analogues).toEqual([])
    expect(reviews[0].regressionRisk).toBe('low')
  })

  it('skips hunks with no added or removed lines', async () => {
    const hunks = [{ file: 'empty.ts', addedLines: [], removedLines: [] }]
    const reviews = await computeCodeReview(hunks, mockProvider)
    expect(reviews).toEqual([])
  })
})

// ===========================================================================
// Sanity checks for pre-existing core functions newly wrapped by MCP/HTTP
// (Phase 148) — confirm they still run cleanly against an empty DB.
// ===========================================================================
describe('insights core functions — empty-DB sanity', () => {
  it('computeSemanticBisect returns a report shape on an empty DB', () => {
    // A date string (not a branch name) for goodRef: resolveRefToTimestamp()
    // tries Date-parsing before falling back to `git log`, so this resolves
    // without depending on a local `main` branch ref — CI checkouts are a
    // shallow, detached-HEAD checkout of just the PR commit, with no other
    // branch refs available locally.
    const result = computeSemanticBisect(MOCK_VEC, 'auth flow', '2020-01-01', 'HEAD', { topK: 5, maxSteps: 3 })
    expect(result.query).toBe('auth flow')
    expect(Array.isArray(result.steps)).toBe(true)
  })

  it('computeRefactorCandidates returns an empty report on an empty DB', () => {
    const report = computeRefactorCandidates({ threshold: 0.88, topK: 10, level: 'file' })
    expect(report.pairs).toEqual([])
    expect(report.totalScanned).toBe(0)
  })

  it('computeConceptLifecycle returns a report shape on an empty DB', () => {
    const result = computeConceptLifecycle(MOCK_VEC, 'auth flow', { steps: 5, threshold: 0.7 })
    expect(result.query).toBe('auth flow')
    expect(Array.isArray(result.points)).toBe(true)
  })

  it('suggestCherryPicks returns an empty array on an empty DB', async () => {
    const results = await suggestCherryPicks(MOCK_VEC, { topK: 5, model: 'mock' })
    expect(results).toEqual([])
  })
})
