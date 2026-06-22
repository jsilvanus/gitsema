/**
 * Tests for Phase 115 (LSP & MCP fleshout §6.1 — "Phase D") — rich hover
 * enrichment. Verifies each optional section (Temporal / Risk & quality /
 * Structure) appears only when its data source is available, per the
 * spec's graceful-degradation contract.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import { SqliteGraphStore } from '../src/core/storage/sqlite/profile.js'
import { clearAnalysisCache } from '../src/core/lsp/analysisCache.js'
import type { GraphEdgeRecord, GraphNodeRecord } from '../src/core/storage/types.js'

vi.mock('../src/core/embedding/providerFactory.js', () => ({
  applyModelOverrides: vi.fn(),
  buildProvider: vi.fn().mockReturnValue({ model: 'm' }),
}))
vi.mock('../src/core/embedding/embedQuery.js', () => ({ embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]) }))
vi.mock('../src/core/search/analysis/vectorSearch.js', () => ({
  vectorSearch: vi.fn().mockResolvedValue([{ blobHash: 'b1', paths: ['a.ts'], score: 0.9 }]),
}))
vi.mock('../src/core/search/debtScoring.js', () => ({
  scoreDebt: vi.fn().mockResolvedValue([
    { paths: ['a.ts'], debtScore: 0.81, isolationScore: 0.5, ageScore: 0.5 },
  ]),
}))

import { handleRequest } from '../src/core/lsp/server.js'

function setupFixtureDb(): { session: DbSession; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-lsphover-'))
  const session = openDatabaseAt(join(tmpDir, 'test.db'))
  return { session, tmpDir }
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
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

function seedSymbol(session: DbSession): void {
  session.rawDb.exec(`INSERT INTO blobs (blob_hash, size, indexed_at) VALUES ('b1', 10, 0)`)
  session.rawDb.exec(`INSERT INTO paths (blob_hash, path) VALUES ('b1', 'a.ts')`)
  session.rawDb.exec(
    `INSERT INTO symbols (blob_hash, start_line, end_line, symbol_name, symbol_kind, language)
     VALUES ('b1', 1, 5, 'myFunc', 'function', 'typescript')`,
  )
}

describe('LSP rich hover (Phase 115)', () => {
  it('always includes the semantic section', async () => {
    await withFixtureDb(async (session) => {
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: { text: 'myFunc' },
      })
      expect(res?.result?.contents?.value).toMatch(/Semantic matches for `myFunc`/)
    })
  })

  it('omits the Temporal section when there are no commits for the blob', async () => {
    await withFixtureDb(async (session) => {
      seedSymbol(session)
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: { text: 'myFunc' },
      })
      expect(res?.result?.contents?.value).not.toMatch(/\*\*Temporal\*\*/)
    })
  })

  it('includes the Temporal section once the blob has a commit', async () => {
    await withFixtureDb(async (session) => {
      seedSymbol(session)
      session.rawDb.exec(
        `INSERT INTO commits (commit_hash, timestamp, message, author_name) VALUES ('c1', 1000, 'init', 'Alice')`,
      )
      session.rawDb.exec(`INSERT INTO blob_commits (blob_hash, commit_hash) VALUES ('b1', 'c1')`)
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 3, method: 'textDocument/hover', params: { text: 'myFunc' },
      })
      expect(res?.result?.contents?.value).toMatch(/\*\*Temporal\*\*/)
      expect(res?.result?.contents?.value).toMatch(/Alice/)
    })
  })

  it('omits the Risk & quality section when the analysis cache is empty', async () => {
    await withFixtureDb(async (session) => {
      seedSymbol(session)
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 4, method: 'textDocument/hover', params: { text: 'myFunc' },
      })
      expect(res?.result?.contents?.value).not.toMatch(/\*\*Risk & quality\*\*/)
    })
  })

  it('includes the Risk & quality section once the analysis cache is populated', async () => {
    await withFixtureDb(async (session) => {
      seedSymbol(session)
      const { refreshAnalysisCache } = await import('../src/core/lsp/analysisCache.js')
      await refreshAnalysisCache(session, { model: 'm' } as any)

      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 5, method: 'textDocument/hover', params: { text: 'myFunc' },
      })
      expect(res?.result?.contents?.value).toMatch(/\*\*Risk & quality\*\*/)
      expect(res?.result?.contents?.value).toMatch(/Debt score: 0\.81/)
    })
  })

  it('omits the Structure section when no graph is built', async () => {
    await withFixtureDb(async (session) => {
      seedSymbol(session)
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 6, method: 'textDocument/hover', params: { text: 'myFunc' },
      })
      expect(res?.result?.contents?.value).not.toMatch(/\*\*Structure\*\*/)
    })
  })

  it('includes the Structure section once the graph is built and the symbol resolves', async () => {
    const NODES: GraphNodeRecord[] = [
      { nodeKey: 'file:a.ts', kind: 'file', displayName: 'a.ts', path: 'a.ts' },
      { nodeKey: 'symbol:a.ts#myFunc#sig1', kind: 'function', displayName: 'myFunc', path: 'a.ts' },
      { nodeKey: 'symbol:a.ts#caller#sig2', kind: 'function', displayName: 'caller', path: 'a.ts' },
    ]
    const EDGES: GraphEdgeRecord[] = [
      { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#myFunc#sig1', edgeType: 'defines' },
      { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#caller#sig2', edgeType: 'defines' },
      { srcKey: 'symbol:a.ts#caller#sig2', dstKey: 'symbol:a.ts#myFunc#sig1', edgeType: 'calls' },
    ]
    await withFixtureDb(async (session) => {
      seedSymbol(session)
      const graph = new SqliteGraphStore()
      await graph.replaceAll(NODES, EDGES)
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 7, method: 'textDocument/hover', params: { text: 'myFunc' },
      })
      expect(res?.result?.contents?.value).toMatch(/\*\*Structure\*\*/)
      expect(res?.result?.contents?.value).toMatch(/Callers: 1/)
    })
  })
})
