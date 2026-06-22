/**
 * Tests for Phase 114 (LSP & MCP fleshout §5 / "Phase C") — structural-first
 * navigation in the LSP server: `textDocument/definition`, `textDocument/references`,
 * and the new `textDocument/prepareCallHierarchy` / `callHierarchy/incomingCalls` /
 * `callHierarchy/outgoingCalls` methods, backed by the Phase 106/107 knowledge graph.
 * Fixture mirrors `tests/graphTraversal.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import { SqliteGraphStore } from '../src/core/storage/sqlite/profile.js'
import { handleRequest } from '../src/core/lsp/server.js'
import type { GraphEdgeRecord, GraphNodeRecord } from '../src/core/storage/types.js'

// file:a.ts --defines--> symbol:A, symbol:B, symbol:C
// symbol:A --calls--> symbol:B --calls--> symbol:C
const NODES: GraphNodeRecord[] = [
  { nodeKey: 'file:a.ts', kind: 'file', displayName: 'a.ts', path: 'a.ts' },
  { nodeKey: 'symbol:a.ts#A#sig1', kind: 'function', displayName: 'A', path: 'a.ts' },
  { nodeKey: 'symbol:a.ts#B#sig2', kind: 'function', displayName: 'B', path: 'a.ts' },
  { nodeKey: 'symbol:a.ts#C#sig3', kind: 'function', displayName: 'C', path: 'a.ts' },
]

const EDGES: GraphEdgeRecord[] = [
  { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#A#sig1', edgeType: 'defines' },
  { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#B#sig2', edgeType: 'defines' },
  { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#C#sig3', edgeType: 'defines' },
  { srcKey: 'symbol:a.ts#A#sig1', dstKey: 'symbol:a.ts#B#sig2', edgeType: 'calls' },
  { srcKey: 'symbol:a.ts#B#sig2', dstKey: 'symbol:a.ts#C#sig3', edgeType: 'calls' },
]

function setupFixtureDb(): { session: DbSession; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-lspstructural-'))
  const session = openDatabaseAt(join(tmpDir, 'test.db'))
  return { session, tmpDir }
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function withGraphDb<T>(fn: (session: DbSession) => Promise<T>): Promise<T> {
  const { session, tmpDir } = setupFixtureDb()
  tmpDirs.push(tmpDir)
  try {
    return await withDbSession(session, async () => {
      const graph = new SqliteGraphStore()
      await graph.replaceAll(NODES, EDGES)
      return fn(session)
    })
  } finally {
    session.rawDb.close()
  }
}

describe('LSP structural-first navigation (Phase 114)', () => {
  it('textDocument/definition resolves structurally when the graph is built', async () => {
    await withGraphDb(async (session) => {
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 1, method: 'textDocument/definition', params: { text: 'B' },
      })
      expect(Array.isArray(res?.result)).toBe(true)
      expect(res!.result).toHaveLength(1)
      expect(res!.result[0].symbolName).toBe('B')
      expect(res!.result[0].tags).toBeUndefined()
    })
  })

  it('textDocument/references resolves structurally when the graph is built', async () => {
    await withGraphDb(async (session) => {
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 2, method: 'textDocument/references', params: { text: 'B' },
      })
      expect(Array.isArray(res?.result)).toBe(true)
      // B has one incoming `calls` edge, from A
      expect(res!.result.map((l: any) => l.symbolName)).toEqual(['A'])
      expect(res!.result[0].tags).toBeUndefined()
    })
  })

  it('textDocument/prepareCallHierarchy resolves a symbol to a CallHierarchyItem', async () => {
    await withGraphDb(async (session) => {
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 3, method: 'textDocument/prepareCallHierarchy', params: { text: 'B' },
      })
      expect(Array.isArray(res?.result)).toBe(true)
      expect(res!.result).toHaveLength(1)
      expect(res!.result[0].name).toBe('B')
      expect(res!.result[0].data).toBe('symbol:a.ts#B#sig2')
    })
  })

  it('callHierarchy/incomingCalls returns exact callers', async () => {
    await withGraphDb(async (session) => {
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 4, method: 'callHierarchy/incomingCalls', params: { text: 'B' },
      })
      expect(Array.isArray(res?.result)).toBe(true)
      expect(res!.result.map((c: any) => c.from.name)).toEqual(['A'])
    })
  })

  it('callHierarchy/outgoingCalls returns exact callees', async () => {
    await withGraphDb(async (session) => {
      const res = await handleRequest(session, {
        jsonrpc: '2.0', id: 5, method: 'callHierarchy/outgoingCalls', params: { text: 'B' },
      })
      expect(Array.isArray(res?.result)).toBe(true)
      expect(res!.result.map((c: any) => c.to.name)).toEqual(['C'])
    })
  })

  it('falls back to semantic/text search, tagged, when no graph exists', async () => {
    const session = openDatabaseAt(':memory:')
    try {
      const res = await withDbSession(session, () => handleRequest(session, {
        jsonrpc: '2.0', id: 6, method: 'textDocument/references', params: { text: 'B' },
      }))
      expect(Array.isArray(res?.result)).toBe(true)
      expect(res!.result).toHaveLength(0)
    } finally {
      session.rawDb.close()
    }
  })
})
