/**
 * Tests for the Phase 108 traversal primitives (knowledge-graph §6/§8):
 * `GraphStore.neighbors/callers/callees/path/subgraph`, the recursive-CTE
 * implementations in `SqliteGraphStore`, and the `core/graph/traversal.ts`
 * wrappers used by `gitsema graph callers|callees|neighbors|path`.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import { SqliteGraphStore } from '../src/core/storage/sqlite/profile.js'
import { callers, callees, neighbors, path as graphPath } from '../src/core/graph/traversal.js'
import type { GraphEdgeRecord, GraphNodeRecord } from '../src/core/storage/types.js'

// ---------------------------------------------------------------------------
// Fixture graph:
//
//   file:a.ts --defines--> symbol:A, symbol:B, symbol:C
//   symbol:A  --calls--> symbol:B --calls--> symbol:C --calls--> external:lib
//
// ---------------------------------------------------------------------------

const NODES: GraphNodeRecord[] = [
  { nodeKey: 'file:a.ts', kind: 'file', displayName: 'a.ts', path: 'a.ts' },
  { nodeKey: 'symbol:a.ts#A#sig1', kind: 'function', displayName: 'A', path: 'a.ts' },
  { nodeKey: 'symbol:a.ts#B#sig2', kind: 'function', displayName: 'B', path: 'a.ts' },
  { nodeKey: 'symbol:a.ts#C#sig3', kind: 'function', displayName: 'C', path: 'a.ts' },
  { nodeKey: 'external:lib', kind: 'external', displayName: 'lib', isExternal: true },
  { nodeKey: 'external:isolated', kind: 'external', displayName: 'isolated', isExternal: true },
]

const EDGES: GraphEdgeRecord[] = [
  { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#A#sig1', edgeType: 'defines' },
  { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#B#sig2', edgeType: 'defines' },
  { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#C#sig3', edgeType: 'defines' },
  { srcKey: 'symbol:a.ts#A#sig1', dstKey: 'symbol:a.ts#B#sig2', edgeType: 'calls' },
  { srcKey: 'symbol:a.ts#B#sig2', dstKey: 'symbol:a.ts#C#sig3', edgeType: 'calls' },
  { srcKey: 'symbol:a.ts#C#sig3', dstKey: 'external:lib', edgeType: 'calls' },
]

function setupFixtureDb(): { session: DbSession; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-graphtraversal-'))
  const session = openDatabaseAt(join(tmpDir, 'test.db'))
  return { session, tmpDir }
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    // Retry logic for Windows EBUSY issues with better-sqlite3
    let retries = 3
    while (retries > 0) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch (err) {
        retries--
        if (retries === 0) throw err
        // Small delay before retry to allow Windows file handles to release
        const startTime = Date.now()
        while (Date.now() - startTime < 100) {
          // Busy-wait to avoid async delay in test cleanup
        }
      }
    }
  }
})

async function withGraph<T>(fn: (graph: SqliteGraphStore, session: DbSession) => Promise<T>): Promise<T> {
  const { session, tmpDir } = setupFixtureDb()
  tmpDirs.push(tmpDir)
  try {
    return await withDbSession(session, async () => {
      const graph = new SqliteGraphStore()
      await graph.replaceAll(NODES, EDGES)
      return fn(graph, session)
    })
  } finally {
    session.rawDb.close()
  }
}

describe('SqliteGraphStore.neighbors', { timeout: 10000 }, () => {
  it('returns depth-1 neighbors by default, in both directions', async () => {
    await withGraph(async (graph) => {
      const hits = await graph.neighbors('symbol:a.ts#B#sig2')
      const keys = hits.map((h) => h.nodeKey).sort()
      // B has a `calls` edge from A, a `calls` edge to C, and a `defines` edge from file:a.ts.
      expect(keys).toEqual(['file:a.ts', 'symbol:a.ts#A#sig1', 'symbol:a.ts#C#sig3'].sort())
      expect(hits.every((h) => h.depth === 1)).toBe(true)
    })
  })

  it('filters by edge type and direction', async () => {
    await withGraph(async (graph) => {
      const hits = await graph.neighbors('file:a.ts', { edgeTypes: ['defines'], direction: 'out' })
      const keys = hits.map((h) => h.nodeKey).sort()
      expect(keys).toEqual([
        'symbol:a.ts#A#sig1',
        'symbol:a.ts#B#sig2',
        'symbol:a.ts#C#sig3',
      ].sort())
      expect(hits.every((h) => h.edgeType === 'defines')).toBe(true)
    })
  })

  it('expands to deeper depth when requested, capped at 3', async () => {
    await withGraph(async (graph) => {
      const hits = await graph.neighbors('symbol:a.ts#A#sig1', { edgeTypes: ['calls'], direction: 'out', depth: 10 })
      const keys = hits.map((h) => h.nodeKey).sort()
      // depth capped at 3: A -calls-> B -calls-> C -calls-> external:lib
      expect(keys).toEqual(['external:lib', 'symbol:a.ts#B#sig2', 'symbol:a.ts#C#sig3'].sort())
      const byKey = new Map(hits.map((h) => [h.nodeKey, h.depth]))
      expect(byKey.get('symbol:a.ts#B#sig2')).toBe(1)
      expect(byKey.get('symbol:a.ts#C#sig3')).toBe(2)
      expect(byKey.get('external:lib')).toBe(3)
    })
  })
})

describe('SqliteGraphStore.callers / callees', { timeout: 10000 }, () => {
  it('callers walks `calls` edges backward', async () => {
    await withGraph(async (graph) => {
      const hits = await graph.callers('symbol:a.ts#C#sig3')
      const byKey = new Map(hits.map((h) => [h.nodeKey, h.depth]))
      expect(byKey.get('symbol:a.ts#B#sig2')).toBe(1)
      expect(byKey.get('symbol:a.ts#A#sig1')).toBe(2)
    })
  })

  it('callees walks `calls` edges forward', async () => {
    await withGraph(async (graph) => {
      const hits = await graph.callees('symbol:a.ts#A#sig1')
      const byKey = new Map(hits.map((h) => [h.nodeKey, h.depth]))
      expect(byKey.get('symbol:a.ts#B#sig2')).toBe(1)
      expect(byKey.get('symbol:a.ts#C#sig3')).toBe(2)
      expect(byKey.get('external:lib')).toBe(3)
    })
  })

  it('respects an explicit depth limit', async () => {
    await withGraph(async (graph) => {
      const hits = await graph.callees('symbol:a.ts#A#sig1', 1)
      expect(hits.map((h) => h.nodeKey)).toEqual(['symbol:a.ts#B#sig2'])
    })
  })
})

describe('SqliteGraphStore.path', { timeout: 10000 }, () => {
  it('finds the shortest typed path between two nodes', async () => {
    await withGraph(async (graph) => {
      const result = await graph.path('symbol:a.ts#A#sig1', 'symbol:a.ts#C#sig3')
      expect(result).not.toBeNull()
      expect(result!.hops.map((h) => h.nodeKey)).toEqual(['symbol:a.ts#B#sig2', 'symbol:a.ts#C#sig3'])
      expect(result!.hops.every((h) => h.edgeType === 'calls' && !h.reversed)).toBe(true)
    })
  })

  it('returns an empty-hop path when from === to', async () => {
    await withGraph(async (graph) => {
      const result = await graph.path('symbol:a.ts#A#sig1', 'symbol:a.ts#A#sig1')
      expect(result).toEqual({ from: 'symbol:a.ts#A#sig1', to: 'symbol:a.ts#A#sig1', hops: [] })
    })
  })

  it('returns null when no path exists within the depth cap', async () => {
    await withGraph(async (graph) => {
      const result = await graph.path('external:lib', 'external:isolated')
      expect(result).toBeNull()
    })
  })
})

describe('SqliteGraphStore.subgraph', { timeout: 10000 }, () => {
  it('returns the node-induced subgraph within depth hops of the seed', async () => {
    await withGraph(async (graph) => {
      const { nodes, edges } = await graph.subgraph('symbol:a.ts#B#sig2', 1)
      const nodeKeys = nodes.map((n) => n.nodeKey).sort()
      expect(nodeKeys).toEqual([
        'file:a.ts',
        'symbol:a.ts#A#sig1',
        'symbol:a.ts#B#sig2',
        'symbol:a.ts#C#sig3',
      ].sort())
      expect(edges.some((e) => e.srcKey === 'symbol:a.ts#A#sig1' && e.dstKey === 'symbol:a.ts#B#sig2')).toBe(true)
      expect(edges.some((e) => e.srcKey === 'symbol:a.ts#B#sig2' && e.dstKey === 'symbol:a.ts#C#sig3')).toBe(true)
    })
  })
})

describe('core/graph/traversal wrappers', { timeout: 10000 }, () => {
  it('resolves a display name to its graph node and traverses callers', async () => {
    await withGraph(async (graph) => {
      const result = await callers(graph, 'C')
      expect(result.resolved.status).toBe('found')
      expect(result.hits.map((h) => h.displayName).sort()).toEqual(['A', 'B'].sort())
    })
  })

  it('resolves a display name and traverses callees', async () => {
    await withGraph(async (graph) => {
      const result = await callees(graph, 'A', 1)
      expect(result.resolved.status).toBe('found')
      expect(result.hits.map((h) => h.displayName)).toEqual(['B'])
    })
  })

  it('returns not-found for an unknown identifier', async () => {
    await withGraph(async (graph) => {
      const result = await neighbors(graph, 'does-not-exist')
      expect(result.resolved.status).toBe('not-found')
      expect(result.hits).toEqual([])
    })
  })

  it('finds a path between two symbols by display name', async () => {
    await withGraph(async (graph) => {
      const result = await graphPath(graph, 'A', 'C')
      expect(result.from.status).toBe('found')
      expect(result.to.status).toBe('found')
      expect(result.path).not.toBeNull()
      expect(result.path!.hops.map((h) => h.displayName)).toEqual(['B', 'C'])
    })
  })
})
