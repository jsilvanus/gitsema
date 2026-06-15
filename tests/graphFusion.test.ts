/**
 * Phase 110 fusion tests (knowledge-graph §7/§8/§10):
 *  - the cascade query planner (`planCascade`): FTS filter → vector expand →
 *    graph traversal → merge/rerank, and its semantic-lens short-circuit
 *  - `computeHotspots`: co-change × call-coupling × churn risk scoring per lens
 *  - `structuralContextForPath`: caller/callee/co-change enrichment facts
 *  - `relate` lens filtering (Phase 111)
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import { SqliteGraphStore } from '../src/core/storage/sqlite/profile.js'
import { planCascade } from '../src/core/graph/cascade.js'
import { computeHotspots, churnByPath } from '../src/core/graph/hotspots.js'
import { structuralContextForPath, formatStructuralContext } from '../src/core/graph/structuralContext.js'
import { relate } from '../src/core/graph/relate.js'
import type { GraphEdgeRecord, GraphNodeRecord } from '../src/core/storage/types.js'

function bufFromArray(arr: number[]) {
  return Buffer.from(new Float32Array(arr).buffer)
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setupDb(): DbSession {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-fusion-'))
  tmpDirs.push(tmpDir)
  return openDatabaseAt(join(tmpDir, 'test.db'))
}

// ---------------------------------------------------------------------------
// Fixture graph:
//   file:a.ts --imports--> file:b.ts
//   file:a.ts --defines--> symbol:A; symbol:A --calls--> symbol:B (in b.ts)
//   co_change: a.ts <-> b.ts (count 4), a.ts <-> c.ts (count 1)
// ---------------------------------------------------------------------------

const NODES: GraphNodeRecord[] = [
  { nodeKey: 'file:a.ts', kind: 'file', displayName: 'a.ts', path: 'a.ts', currentBlobHash: 'blobA' },
  { nodeKey: 'file:b.ts', kind: 'file', displayName: 'b.ts', path: 'b.ts', currentBlobHash: 'blobB' },
  { nodeKey: 'file:c.ts', kind: 'file', displayName: 'c.ts', path: 'c.ts', currentBlobHash: 'blobC' },
  { nodeKey: 'symbol:a.ts#A#s1', kind: 'function', displayName: 'A', path: 'a.ts', currentBlobHash: 'blobA' },
  { nodeKey: 'symbol:b.ts#B#s2', kind: 'function', displayName: 'B', path: 'b.ts', currentBlobHash: 'blobB' },
]

const EDGES: GraphEdgeRecord[] = [
  { srcKey: 'file:a.ts', dstKey: 'file:b.ts', edgeType: 'imports' },
  { srcKey: 'file:a.ts', dstKey: 'symbol:a.ts#A#s1', edgeType: 'defines' },
  { srcKey: 'file:b.ts', dstKey: 'symbol:b.ts#B#s2', edgeType: 'defines' },
  { srcKey: 'symbol:a.ts#A#s1', dstKey: 'symbol:b.ts#B#s2', edgeType: 'calls' },
  { srcKey: 'file:a.ts', dstKey: 'file:b.ts', edgeType: 'co_change', observedCount: 4 },
  { srcKey: 'file:b.ts', dstKey: 'file:a.ts', edgeType: 'co_change', observedCount: 4 },
  { srcKey: 'file:a.ts', dstKey: 'file:c.ts', edgeType: 'co_change', observedCount: 1 },
  { srcKey: 'file:c.ts', dstKey: 'file:a.ts', edgeType: 'co_change', observedCount: 1 },
]

async function withFixture<T>(fn: (graph: SqliteGraphStore, session: DbSession) => Promise<T>): Promise<T> {
  const session = setupDb()
  try {
    return await withDbSession(session, async () => {
      const graph = new SqliteGraphStore()
      await graph.replaceAll(NODES, EDGES)

      for (const [hash, path, vec] of [
        ['blobA', 'a.ts', [1, 0, 0, 0]],
        ['blobB', 'b.ts', [0, 1, 0, 0]],
        ['blobC', 'c.ts', [0, 0, 1, 0]],
      ] as Array<[string, string, number[]]>) {
        session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run(hash, 10, 1)
        session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)').run(hash, 'm', 4, bufFromArray(vec))
        session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run(hash, path)
      }
      return fn(graph, session)
    })
  } finally {
    session.rawDb.close()
  }
}

describe('planCascade (Phase 110)', () => {
  it('semantic lens runs FTS+vector only and returns the vector ranking unchanged', async () => {
    await withFixture(async (graph) => {
      const result = await planCascade({ query: 'auth', queryEmbedding: [1, 0, 0, 0], graph, lens: 'semantic', topK: 3 })
      expect(result.lens).toBe('semantic')
      expect(result.stages).not.toContain('graph-traversal')
      expect(result.hits[0].blobHash).toBe('blobA')
      // Every hit is labeled semantic-only and carries no structural score.
      for (const h of result.hits) {
        expect(h.lenses).toEqual(['semantic'])
        expect(h.structuralScore).toBe(0)
      }
    })
  })

  it('hybrid lens expands structurally so an imported-but-dissimilar file surfaces', async () => {
    await withFixture(async (graph) => {
      const result = await planCascade({ query: 'auth', queryEmbedding: [1, 0, 0, 0], graph, lens: 'hybrid', topK: 5 })
      expect(result.stages).toContain('graph-traversal')
      expect(result.stages).toContain('merge-rerank')
      const byHash = new Map(result.hits.map((h) => [h.blobHash, h]))
      // blobB is reached only via the a.ts->b.ts import edge (its embedding is
      // orthogonal to the query), so it must carry a structural signal.
      expect(byHash.get('blobB')).toBeDefined()
      expect(byHash.get('blobB')!.structuralScore).toBeGreaterThan(0)
      expect(byHash.get('blobB')!.lenses).toContain('structural')
    })
  })

  it('structural lens keeps only structurally-reached hits', async () => {
    await withFixture(async (graph) => {
      const result = await planCascade({ query: 'auth', queryEmbedding: [1, 0, 0, 0], graph, lens: 'structural', topK: 5 })
      for (const h of result.hits) {
        expect(h.structuralScore).toBeGreaterThan(0)
        expect(h.lenses).toEqual(['structural'])
      }
    })
  })
})

describe('computeHotspots (Phase 110)', () => {
  it('hybrid lens fuses co-change × coupling × churn and ranks the busiest file first', async () => {
    await withFixture(async (graph) => {
      const churn = new Map([['a.ts', 10], ['b.ts', 5], ['c.ts', 1]])
      const result = await computeHotspots(graph, { lens: 'hybrid', churnByPath: churn })
      expect(result.lens).toBe('hybrid')
      expect(result.hotspots.length).toBeGreaterThan(0)
      // a.ts is the most coupled, most co-changed, and highest churn → top risk.
      expect(result.hotspots[0].path).toBe('a.ts')
      expect(result.hotspots[0].lenses.length).toBeGreaterThan(0)
      expect(result.hotspots[0].risk).toBeGreaterThan(0)
    })
  })

  it('structural lens scores by coupling only', async () => {
    await withFixture(async (graph) => {
      const result = await computeHotspots(graph, { lens: 'structural' })
      // c.ts has no structural edges → coupling 0 → excluded.
      const paths = result.hotspots.map((h) => h.path)
      expect(paths).not.toContain('c.ts')
      for (const h of result.hotspots) expect(h.lenses).toEqual(['structural'])
    })
  })

  it('churnByPath() counts distinct commits per path from blob_commits', async () => {
    await withFixture(async (_graph, session) => {
      session.rawDb.prepare('INSERT INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)').run('c1', 1, 'one')
      session.rawDb.prepare('INSERT INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)').run('c2', 2, 'two')
      session.rawDb.prepare('INSERT INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)').run('blobA', 'c1')
      session.rawDb.prepare('INSERT INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)').run('blobA', 'c2')
      session.rawDb.prepare('INSERT INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)').run('blobB', 'c1')

      const churn = churnByPath()
      expect(churn.get('a.ts')).toBe(2)
      expect(churn.get('b.ts')).toBe(1)
    })
  })
})

describe('structuralContextForPath (Phase 110)', () => {
  it('reports caller/callee/co-change facts for a file node', async () => {
    await withFixture(async (graph) => {
      const ctx = await structuralContextForPath(graph, 'a.ts')
      expect(ctx.found).toBe(true)
      // a.ts co-changes most strongly with b.ts (4 of 5 total).
      expect(ctx.coChange[0].path).toBe('b.ts')
      expect(ctx.coChange[0].ratio).toBeCloseTo(4 / 5, 3)
      const summary = formatStructuralContext(ctx)
      expect(summary).toContain('b.ts')
    })
  })

  it('returns found:false for an unknown path (never throws)', async () => {
    await withFixture(async (graph) => {
      const ctx = await structuralContextForPath(graph, 'nope.ts')
      expect(ctx.found).toBe(false)
      expect(formatStructuralContext(ctx)).toBeUndefined()
    })
  })
})

describe('relate lens filtering (Phase 111)', () => {
  it('lens=structural omits the semantic section', async () => {
    await withFixture(async (graph) => {
      const result = await relate(graph, 'A', { lens: 'structural' })
      expect(result.lens).toBe('structural')
      expect(result.similar).toEqual([])
      expect(result.callees.map((h) => h.displayName)).toEqual(['B'])
    })
  })

  it('lens=semantic omits the structural sections', async () => {
    await withFixture(async (graph) => {
      const result = await relate(graph, 'A', { lens: 'semantic' })
      expect(result.callers).toEqual([])
      expect(result.callees).toEqual([])
    })
  })
})
