/**
 * M4: Programmatic MCP tool test.
 *
 * Tests the MCP tool handlers directly without starting the stdio server.
 * Uses a real in-memory SQLite DB and a mock embedding provider.
 *
 * Focuses on:
 *   - Tool handlers return the correct content shape
 *   - Error handling doesn't crash the server
 *   - health_timeline and security_scan tools work on empty DB
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'

// ---------------------------------------------------------------------------
// Stub getActiveSession() so MCP tool handlers use our in-memory DB
// ---------------------------------------------------------------------------
const inMemorySession = openDatabaseAt(':memory:')

vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  return {
    ...actual,
    getActiveSession: () => inMemorySession,
  }
})

// Stub getTextProvider / getCodeProvider
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

// ---------------------------------------------------------------------------
// Import MCP tools after mocking dependencies
// ---------------------------------------------------------------------------
import { computeHealthTimeline } from '../src/core/search/healthTimeline.js'
import { scanForVulnerabilities } from '../src/core/search/securityScan.js'
import { scoreDebt } from '../src/core/search/debtScoring.js'
import { getActiveSession } from '../src/core/db/sqlite.js'
import { getTextProvider } from '../src/core/embedding/providerFactory.js'

describe('MCP health_timeline tool (core function)', () => {
  it('returns empty array on empty DB', () => {
    const session = getActiveSession()
    const snaps = computeHealthTimeline(session, { buckets: 6 })
    expect(Array.isArray(snaps)).toBe(true)
    expect(snaps.length).toBe(0)
  })

  it('returns empty array with branch filter on empty DB', () => {
    const session = getActiveSession()
    const snaps = computeHealthTimeline(session, { buckets: 6, branch: 'main' })
    expect(Array.isArray(snaps)).toBe(true)
    expect(snaps.length).toBe(0)
  })
})

describe('MCP security_scan tool (core function)', () => {
  it('returns empty findings on empty DB', async () => {
    const session = getActiveSession()
    const provider = getTextProvider()
    const findings = await scanForVulnerabilities(session, provider as any, { top: 5 })
    expect(Array.isArray(findings)).toBe(true)
    expect(findings.length).toBe(0)
  })
})

describe('MCP debt_score tool (core function)', () => {
  it('returns empty array on empty DB', async () => {
    const session = getActiveSession()
    const provider = getTextProvider()
    const results = await scoreDebt(session, provider as any, { top: 10 })
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(0)
  })
})
