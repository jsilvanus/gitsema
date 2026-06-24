/**
 * Tests for Phase 115 (LSP & MCP fleshout §6.2/§6.4 — "Phase D") — background
 * analysis cache, diagnostics thresholds, the background refresh loop, and
 * the `--diagnostics` opt-in / remote-mode gating in `server.ts`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'

vi.mock('../src/core/embedding/providerFactory.js', () => ({
  applyModelOverrides: vi.fn(),
  buildProvider: vi.fn().mockReturnValue({ model: 'm' }),
}))
vi.mock('../src/core/embedding/embedQuery.js', () => ({ embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]) }))
vi.mock('../src/core/search/analysis/vectorSearch.js', () => ({
  vectorSearch: vi.fn().mockResolvedValue([]),
}))
vi.mock('../src/core/search/debtScoring.js', () => ({ scoreDebt: vi.fn().mockResolvedValue([]) }))
vi.mock('../src/core/search/securityScan.js', () => ({ scanForVulnerabilities: vi.fn().mockResolvedValue([]) }))
vi.mock('../src/core/graph/hotspots.js', () => ({
  computeHotspots: vi.fn().mockResolvedValue({ hotspots: [] }),
  churnByPath: vi.fn().mockReturnValue(new Map()),
}))
vi.mock('../src/core/lsp/structuralNav.js', () => ({
  activeGraphStore: vi.fn().mockReturnValue({}),
  isGraphBuilt: vi.fn().mockResolvedValue(true),
}))

import { scoreDebt } from '../src/core/search/debtScoring.js'
import { computeHotspots } from '../src/core/graph/hotspots.js'
import {
  clearAnalysisCache,
  computeDiagnosticsFromCache,
  refreshAnalysisCache,
  startBackgroundRefresh,
  DIAGNOSTIC_SEVERITY,
} from '../src/core/lsp/analysisCache.js'
import { startLspServer } from '../src/core/lsp/server.js'

function setupFixtureDb(): { session: DbSession; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-lspdiag-'))
  const session = openDatabaseAt(join(tmpDir, 'test.db'))
  return { session, tmpDir }
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

beforeEach(() => {
  clearAnalysisCache()
})

async function withFixtureDb<T>(fn: (session: DbSession) => Promise<T>): Promise<T> {
  const { session, tmpDir } = setupFixtureDb()
  tmpDirs.push(tmpDir)
  try {
    return await withDbSession(session, () => fn(session))
  } finally {
    session.rawDb.close()
  }
}

describe('analysis cache & diagnostics thresholds (Phase 115)', () => {
  it('computeDiagnosticsFromCache returns nothing before the cache is populated', () => {
    expect(computeDiagnosticsFromCache().size).toBe(0)
  })

  it('flags a path above the debt threshold but not one below it', async () => {
    await withFixtureDb(async (session) => {
      vi.mocked(scoreDebt).mockResolvedValueOnce([
        { paths: ['risky.ts'], debtScore: 0.9, isolationScore: 0.5, ageScore: 0.5 } as any,
        { paths: ['safe.ts'], debtScore: 0.3, isolationScore: 0.1, ageScore: 0.1 } as any,
      ])
      await refreshAnalysisCache(session, { model: 'm' } as any)
      const diagnostics = computeDiagnosticsFromCache()
      expect(diagnostics.has('risky.ts')).toBe(true)
      expect(diagnostics.get('risky.ts')![0].severity).toBe(DIAGNOSTIC_SEVERITY.warning)
      expect(diagnostics.get('risky.ts')![0].message).toMatch(/0\.90/)
      expect(diagnostics.has('safe.ts')).toBe(false)
    })
  }, 15000)

  it('flags a path above the hotspot threshold but not one below it', async () => {
    await withFixtureDb(async (session) => {
      vi.mocked(computeHotspots).mockResolvedValueOnce({
        hotspots: [
          { path: 'hot.ts', risk: 0.75 } as any,
          { path: 'cold.ts', risk: 0.2 } as any,
        ],
      } as any)
      await refreshAnalysisCache(session, { model: 'm' } as any)
      const diagnostics = computeDiagnosticsFromCache()
      expect(diagnostics.has('hot.ts')).toBe(true)
      expect(diagnostics.get('hot.ts')![0].severity).toBe(DIAGNOSTIC_SEVERITY.information)
      expect(diagnostics.has('cold.ts')).toBe(false)
    })
  }, 15000)

  it('startBackgroundRefresh runs once immediately and reports diagnostics', async () => {
    await withFixtureDb(async (session) => {
      vi.mocked(scoreDebt).mockResolvedValueOnce([
        { paths: ['risky.ts'], debtScore: 0.95, isolationScore: 0.5, ageScore: 0.5 } as any,
      ])
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(123 as any)
      const onRefresh = vi.fn()
      const handle = startBackgroundRefresh(session, { model: 'm' } as any, 999999, onRefresh)
      expect(handle).toBe(123)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(onRefresh).toHaveBeenCalledTimes(1)
      const diagnosticsByPath = onRefresh.mock.calls[0][0] as Map<string, unknown>
      expect(diagnosticsByPath.has('risky.ts')).toBe(true)
      setIntervalSpy.mockRestore()
    })
  }, 15000)
})

describe('LSP diagnostics push notifications & gating (Phase 115)', () => {
  it('pushes a textDocument/publishDiagnostics notification over stdout when --diagnostics is on', async () => {
    await withFixtureDb(async (session) => {
      vi.mocked(scoreDebt).mockResolvedValueOnce([
        { paths: ['risky.ts'], debtScore: 0.9, isolationScore: 0.5, ageScore: 0.5 } as any,
      ])
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(1 as any)
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

      startLspServer(session, undefined, { diagnostics: true })
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(writeSpy).toHaveBeenCalled()
      const payload = writeSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(payload).toMatch(/textDocument\/publishDiagnostics/)
      expect(payload).toMatch(/risky\.ts/)
      setIntervalSpy.mockRestore()
      writeSpy.mockRestore()
    })
  }, 15000)

  it('does not start diagnostics when --diagnostics is not passed', async () => {
    await withFixtureDb(async (session) => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval')
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

      startLspServer(session, undefined, {})
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(setIntervalSpy).not.toHaveBeenCalled()
      expect(writeSpy).not.toHaveBeenCalled()
      setIntervalSpy.mockRestore()
      writeSpy.mockRestore()
    })
  }, 15000)

  it('does not start diagnostics when a --remote config is set, even with --diagnostics', async () => {
    await withFixtureDb(async (session) => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval')
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

      startLspServer(session, { url: 'http://localhost:4242' }, { diagnostics: true })
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(setIntervalSpy).not.toHaveBeenCalled()
      expect(writeSpy).not.toHaveBeenCalled()
      setIntervalSpy.mockRestore()
      writeSpy.mockRestore()
    })
  }, 15000)
})
