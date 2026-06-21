/**
 * Phase 112 tests (knowledge-graph §9): the unified `RenderableSubgraph`
 * model (`subgraphFromSeed`/`subgraphFromSeeds`/`subgraphFromPath`/
 * `subgraphFromHotspots`, `suggestedCommands`) and its two render targets —
 * the CLI ASCII tree/markdown (`cli/lib/graphRender.ts`) and the HTML
 * force-graph (`core/viz/htmlRenderer-graph.ts`).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import { SqliteGraphStore } from '../src/core/storage/sqlite/profile.js'
import {
  subgraphFromSeed,
  subgraphFromSeeds,
  subgraphFromPath,
  subgraphFromHotspots,
  suggestedCommands,
} from '../src/core/graph/subgraphView.js'
import { renderGraphTree, renderGraphMarkdown } from '../src/cli/lib/graphRender.js'
import { renderGraphHtml } from '../src/core/viz/htmlRenderer-graph.js'
import type { GraphEdgeRecord, GraphNodeRecord, GraphPath } from '../src/core/storage/types.js'
import type { HotspotScore } from '../src/core/graph/hotspots.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setupDb(): DbSession {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-subgraph-'))
  tmpDirs.push(tmpDir)
  return openDatabaseAt(join(tmpDir, 'test.db'))
}

// Fixture graph: file:a.ts --imports--> file:b.ts --imports--> file:c.ts
// plus a.ts defines symbol:A which calls symbol:B in b.ts.
const NODES: GraphNodeRecord[] = [
  { nodeKey: 'file:a.ts', kind: 'file', displayName: 'a.ts', path: 'a.ts' },
  { nodeKey: 'file:b.ts', kind: 'file', displayName: 'b.ts', path: 'b.ts' },
  { nodeKey: 'file:c.ts', kind: 'file', displayName: 'c.ts', path: 'c.ts' },
  { nodeKey: 'symbol:a.ts#A#s1', kind: 'function', displayName: 'A', path: 'a.ts' },
  { nodeKey: 'symbol:b.ts#B#s2', kind: 'function', displayName: 'B', path: 'b.ts' },
  { nodeKey: 'external:lodash', kind: 'external', displayName: 'lodash', isExternal: true },
]

const EDGES: GraphEdgeRecord[] = [
  { srcKey: 'file:a.ts', dstKey: 'file:b.ts', edgeType: 'imports' },
  { srcKey: 'file:b.ts', dstKey: 'file:c.ts', edgeType: 'imports' },
  { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#A#s1', edgeType: 'defines' },
  { srcKey: 'file:b.ts', dstKey: 'symbol:b.ts#B#s2', edgeType: 'defines' },
  { srcKey: 'symbol:a.ts#A#s1', dstKey: 'symbol:b.ts#B#s2', edgeType: 'calls' },
  { srcKey: 'file:a.ts', dstKey: 'external:lodash', edgeType: 'imports' },
  { srcKey: 'file:a.ts', dstKey: 'file:b.ts', edgeType: 'co_change', observedCount: 3 },
  { srcKey: 'file:b.ts', dstKey: 'file:a.ts', edgeType: 'co_change', observedCount: 3 },
]

async function withFixture<T>(fn: (graph: SqliteGraphStore) => Promise<T>): Promise<T> {
  const session = setupDb()
  try {
    return await withDbSession(session, async () => {
      const graph = new SqliteGraphStore()
      await graph.replaceAll(NODES, EDGES)
      return fn(graph)
    })
  } finally {
    session.rawDb.close()
  }
}

describe('subgraphFromSeed', () => {
  it('returns the node-induced subgraph rooted at the seed', async () => {
    await withFixture(async (graph) => {
      const sub = await subgraphFromSeed(graph, 'file:a.ts', 1)
      expect(sub.rootKeys).toEqual(['file:a.ts'])
      const keys = sub.nodes.map((n) => n.nodeKey)
      expect(keys).toContain('file:a.ts')
      expect(keys).toContain('file:b.ts')
      expect(sub.edges.length).toBeGreaterThan(0)
    })
  })
})

describe('subgraphFromSeeds', () => {
  it('unions node-induced subgraphs around multiple seeds without duplicate edges', async () => {
    await withFixture(async (graph) => {
      const sub = await subgraphFromSeeds(graph, ['file:a.ts', 'file:c.ts'], 1)
      expect(sub.rootKeys).toEqual(['file:a.ts', 'file:c.ts'])
      const keys = new Set(sub.nodes.map((n) => n.nodeKey))
      expect(keys.has('file:a.ts')).toBe(true)
      expect(keys.has('file:c.ts')).toBe(true)
      const edgeKeys = sub.edges.map((e) => `${e.srcKey}|${e.dstKey}|${e.edgeType}`)
      expect(new Set(edgeKeys).size).toBe(edgeKeys.length)
    })
  })
})

describe('subgraphFromPath', () => {
  it('builds a linear subgraph following the path hops', async () => {
    await withFixture(async (graph) => {
      const path: GraphPath = {
        hops: [
          { nodeKey: 'file:b.ts', displayName: 'b.ts', edgeType: 'imports', reversed: false },
          { nodeKey: 'file:c.ts', displayName: 'c.ts', edgeType: 'imports', reversed: false },
        ],
      }
      const sub = await subgraphFromPath(graph, 'file:a.ts', 'file:c.ts', path)
      expect(sub.rootKeys).toEqual(['file:a.ts', 'file:c.ts'])
      expect(sub.nodes.map((n) => n.nodeKey)).toEqual(['file:a.ts', 'file:b.ts', 'file:c.ts'])
      expect(sub.edges).toEqual([
        { srcKey: 'file:a.ts', dstKey: 'file:b.ts', edgeType: 'imports' },
        { srcKey: 'file:b.ts', dstKey: 'file:c.ts', edgeType: 'imports' },
      ])
    })
  })

  it('reverses edge direction for reversed hops', async () => {
    await withFixture(async (graph) => {
      const path: GraphPath = {
        hops: [{ nodeKey: 'file:a.ts', displayName: 'a.ts', edgeType: 'imports', reversed: true }],
      }
      const sub = await subgraphFromPath(graph, 'file:b.ts', 'file:a.ts', path)
      expect(sub.edges).toEqual([{ srcKey: 'file:a.ts', dstKey: 'file:b.ts', edgeType: 'imports' }])
    })
  })
})

describe('subgraphFromHotspots', () => {
  it('keeps only hotspot nodes and the coupling/co-change edges among them, with risk weights', async () => {
    await withFixture(async (graph) => {
      const hotspots: HotspotScore[] = [
        { nodeKey: 'file:a.ts', path: 'a.ts', risk: 0.8, coChange: 3, coChangeNorm: 1, coupling: 2, couplingNorm: 1, churn: 0, churnNorm: 0, lenses: ['hybrid'] },
        { nodeKey: 'file:b.ts', path: 'b.ts', risk: 0.5, coChange: 3, coChangeNorm: 1, coupling: 1, couplingNorm: 0.5, churn: 0, churnNorm: 0, lenses: ['hybrid'] },
      ]
      const sub = await subgraphFromHotspots(graph, hotspots)
      expect(new Set(sub.rootKeys)).toEqual(new Set(['file:a.ts', 'file:b.ts']))
      expect(sub.nodes.map((n) => n.nodeKey).sort()).toEqual(['file:a.ts', 'file:b.ts'])
      expect(sub.weights).toEqual({ 'file:a.ts': 0.8, 'file:b.ts': 0.5 })
      // c.ts is not a hotspot, so the a.ts<->c.ts-adjacent edges must be excluded entirely
      // (only co_change/imports/calls edges between a.ts and b.ts survive).
      for (const e of sub.edges) {
        expect(['file:a.ts', 'file:b.ts']).toContain(e.srcKey)
        expect(['file:a.ts', 'file:b.ts']).toContain(e.dstKey)
      }
    })
  })
})

describe('suggestedCommands', () => {
  it('suggests file-evolution and search for file nodes', () => {
    const node: GraphNodeRecord = { nodeKey: 'file:a.ts', kind: 'file', displayName: 'a.ts', path: 'a.ts' }
    const cmds = suggestedCommands(node)
    expect(cmds.some((c) => c.includes('file-evolution'))).toBe(true)
    expect(cmds.some((c) => c.includes('search'))).toBe(true)
  })

  it('suggests search for external nodes', () => {
    const node: GraphNodeRecord = { nodeKey: 'external:lodash', kind: 'external', displayName: 'lodash', isExternal: true }
    const cmds = suggestedCommands(node)
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toContain('search')
  })

  it('suggests search and relate for symbol nodes', () => {
    const node: GraphNodeRecord = { nodeKey: 'symbol:a.ts#A#s1', kind: 'function', displayName: 'A', path: 'a.ts' }
    const cmds = suggestedCommands(node)
    expect(cmds.some((c) => c.includes('relate'))).toBe(true)
  })
})

describe('renderGraphTree', () => {
  it('renders an indented ASCII tree rooted at the seed', async () => {
    await withFixture(async (graph) => {
      const sub = await subgraphFromSeed(graph, 'file:a.ts', 1)
      const text = renderGraphTree(sub)
      expect(text).toContain('a.ts [file]')
      expect(text).toContain('b.ts [file]')
      expect(text).toMatch(/-\[imports\]->/)
    })
  })

  it('marks already-visited nodes instead of looping forever on cycles', async () => {
    const cyclic = { rootKeys: ['x'], nodes: [
      { nodeKey: 'x', kind: 'file', displayName: 'x', path: 'x' },
      { nodeKey: 'y', kind: 'file', displayName: 'y', path: 'y' },
    ], edges: [
      { srcKey: 'x', dstKey: 'y', edgeType: 'imports' as const },
      { srcKey: 'y', dstKey: 'x', edgeType: 'imports' as const },
    ] }
    const text = renderGraphTree(cyclic)
    expect(text).toContain('(...)')
  })

  it('renders a placeholder for an empty subgraph', () => {
    expect(renderGraphTree({ rootKeys: [], nodes: [], edges: [] })).toBe('(empty subgraph)')
  })

  it('shows risk weights when present', async () => {
    await withFixture(async (graph) => {
      const hotspots: HotspotScore[] = [
        { nodeKey: 'file:a.ts', path: 'a.ts', risk: 0.654, coChange: 1, coChangeNorm: 1, coupling: 1, couplingNorm: 1, churn: 0, churnNorm: 0, lenses: ['hybrid'] },
      ]
      const sub = await subgraphFromHotspots(graph, hotspots)
      const text = renderGraphTree(sub)
      expect(text).toContain('risk 0.654')
    })
  })
})

describe('renderGraphMarkdown', () => {
  it('renders a nested bullet list', async () => {
    await withFixture(async (graph) => {
      const sub = await subgraphFromSeed(graph, 'file:a.ts', 1)
      const md = renderGraphMarkdown(sub)
      expect(md).toContain('**a.ts**')
      expect(md).toMatch(/`imports`/)
    })
  })

  it('renders a placeholder for an empty subgraph', () => {
    expect(renderGraphMarkdown({ rootKeys: [], nodes: [], edges: [] })).toBe('_(empty subgraph)_')
  })
})

describe('renderGraphHtml', () => {
  it('embeds node/edge data and the title into the HTML document', async () => {
    await withFixture(async (graph) => {
      const sub = await subgraphFromSeed(graph, 'file:a.ts', 1)
      const html = renderGraphHtml(sub, { title: 'Test subgraph' })
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Test subgraph')
      expect(html).toContain('"key":"file:a.ts"')
      expect(html).toContain('viz-canvas')
    })
  })

  it('escapes user-controlled strings so they cannot break out of the script context', () => {
    const sub = {
      rootKeys: ['file:a.ts'],
      nodes: [{ nodeKey: 'file:a.ts', kind: 'file', displayName: '</script><script>alert(1)</script>', path: 'a.ts' }],
      edges: [],
    }
    const html = renderGraphHtml(sub)
    expect(html).not.toContain('</script><script>alert(1)</script>')
  })
})
