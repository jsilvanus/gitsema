/**
 * Tests for the Phase 109 `--lens` toggle (knowledge-graph §7/§8):
 *  - the four-signal `vectorSearch` ranking formula (`weightStructural` /
 *    `structuralScores`), and its semantic-lens-identical default behavior
 *  - the `blastRadius` / `relate` / `similar` / `unused` core modules.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import { SqliteGraphStore } from '../src/core/storage/sqlite/profile.js'
import { vectorSearch } from '../src/core/search/analysis/vectorSearch.js'
import { blastRadius } from '../src/core/graph/blastRadius.js'
import { relate } from '../src/core/graph/relate.js'
import { similar } from '../src/core/graph/similar.js'
import { unused } from '../src/core/graph/unused.js'
import type { GraphEdgeRecord, GraphNodeRecord } from '../src/core/storage/types.js'

function bufFromArray(arr: number[]) {
  return Buffer.from(new Float32Array(arr).buffer)
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function setupDb(): { session: DbSession; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-graphlens-'))
  const session = openDatabaseAt(join(tmpDir, 'test.db'))
  tmpDirs.push(tmpDir)
  return { session, tmpDir }
}

// ---------------------------------------------------------------------------
// vectorSearch four-signal ranking
// ---------------------------------------------------------------------------

describe('vectorSearch — four-signal ranking (Phase 109)', () => {
  it('semantic lens (no structural options) is identical to pre-Phase-109 cosine ranking', async () => {
    const { session } = setupDb()
    await withDbSession(session, async () => {
      session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobA', 10, 1)
      session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobB', 10, 1)
      session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
        .run('blobA', 'm', 4, bufFromArray([1, 0, 0, 0]))
      session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
        .run('blobB', 'm', 4, bufFromArray([0, 1, 0, 0]))
      session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobA', 'a.ts')
      session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobB', 'b.ts')

      const results = await vectorSearch([1, 0, 0, 0], { topK: 10, noCache: true })
      expect(results.map((r) => r.blobHash)).toEqual(['blobA', 'blobB'])
      // No weighted-signals options set -> score === cosine similarity.
      expect(results[0].score).toBeCloseTo(1, 6)
      expect(results[1].score).toBeCloseTo(0, 6)
    })
  })

  it('weightStructural + structuralScores reorders results via the four-signal formula', async () => {
    const { session } = setupDb()
    await withDbSession(session, async () => {
      session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobA', 10, 1)
      session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobB', 10, 1)
      // blobA is closer to the query vector by cosine...
      session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
        .run('blobA', 'm', 4, bufFromArray([1, 0, 0, 0]))
      session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
        .run('blobB', 'm', 4, bufFromArray([0.9, 0.1, 0, 0]))
      session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobA', 'a.ts')
      session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobB', 'b.ts')

      // ...but blobB is structurally adjacent to the query anchor (score 1),
      // while blobA has no structural relation (score 0).
      const structuralScores = new Map([['blobB', 1]])

      const results = await vectorSearch([1, 0, 0, 0], {
        topK: 10,
        noCache: true,
        weightVector: 0,
        weightRecency: 0,
        weightPath: 0,
        weightStructural: 1,
        structuralScores,
        explain: true,
      })

      const byHash = new Map(results.map((r) => [r.blobHash, r]))
      // wTotal = 0+0+0+1 = 1, so score === structScore directly.
      expect(byHash.get('blobB')!.score).toBeCloseTo(1, 6)
      expect(byHash.get('blobA')!.score).toBeCloseTo(0, 6)
      expect(byHash.get('blobB')!.signals?.structural).toBeCloseTo(1, 6)
      expect(byHash.get('blobA')!.signals?.structural ?? 0).toBeCloseTo(0, 6)
      // blobB now outranks blobA despite the lower cosine similarity.
      expect(results[0].blobHash).toBe('blobB')
    })
  })

  it('blends all four signals according to the supplied weights', async () => {
    const { session } = setupDb()
    await withDbSession(session, async () => {
      session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobA', 10, 1)
      session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
        .run('blobA', 'm', 4, bufFromArray([1, 0, 0, 0]))
      session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobA', 'a.ts')

      const structuralScores = new Map([['blobA', 0.5]])
      const results = await vectorSearch([1, 0, 0, 0], {
        topK: 10,
        noCache: true,
        weightVector: 1,
        weightRecency: 0,
        weightPath: 0,
        weightStructural: 1,
        structuralScores,
        explain: true,
      })

      // wTotal = 1+0+0+1 = 2; cosine=1, structural=0.5 -> score = (1*1 + 1*0.5) / 2 = 0.75
      expect(results[0].score).toBeCloseTo(0.75, 6)
    })
  })
})

// ---------------------------------------------------------------------------
// blastRadius / relate / similar / unused fixture graph:
//
//   file:a.ts --defines--> symbol:A, symbol:B, symbol:C
//   symbol:A  --calls--> symbol:B --calls--> symbol:C --calls--> external:lib
//   file:a.ts --imports--> external:lib
//   file:b.ts --imports--> external:lib
//
// ---------------------------------------------------------------------------

const NODES: GraphNodeRecord[] = [
  { nodeKey: 'file:a.ts', kind: 'file', displayName: 'a.ts', path: 'a.ts', currentBlobHash: 'blobA' },
  { nodeKey: 'file:b.ts', kind: 'file', displayName: 'b.ts', path: 'b.ts', currentBlobHash: 'blobB' },
  { nodeKey: 'symbol:a.ts#A#sig1', kind: 'function', displayName: 'A', path: 'a.ts', currentBlobHash: 'blobA' },
  { nodeKey: 'symbol:a.ts#B#sig2', kind: 'function', displayName: 'B', path: 'a.ts', currentBlobHash: 'blobA' },
  { nodeKey: 'symbol:a.ts#C#sig3', kind: 'function', displayName: 'C', path: 'a.ts', currentBlobHash: 'blobA' },
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
  { srcKey: 'file:a.ts', dstKey: 'external:lib', edgeType: 'imports' },
  { srcKey: 'file:b.ts', dstKey: 'external:lib', edgeType: 'imports' },
]

async function withFusionGraph<T>(fn: (graph: SqliteGraphStore, session: DbSession) => Promise<T>): Promise<T> {
  const { session } = setupDb()
  return withDbSession(session, async () => {
    const graph = new SqliteGraphStore()
    await graph.replaceAll(NODES, EDGES)

    // Seed embeddings/symbols so semanticNeighborsForNode() has data to rank.
    session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobA', 10, 1)
    session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobB', 10, 1)
    session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
      .run('blobA', 'm', 4, bufFromArray([1, 0, 0, 0]))
    session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
      .run('blobB', 'm', 4, bufFromArray([0.9, 0.1, 0, 0]))
    session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobA', 'a.ts')
    session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobB', 'b.ts')

    const insertSymbol = session.rawDb.prepare(
      'INSERT INTO symbols (blob_hash, start_line, end_line, symbol_name, symbol_kind, language, qualified_name, signature_hash) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const symA = insertSymbol.run('blobA', 1, 2, 'A', 'function', 'typescript', 'A', 'sig1').lastInsertRowid as number
    const symB = insertSymbol.run('blobA', 3, 4, 'B', 'function', 'typescript', 'B', 'sig2').lastInsertRowid as number
    const symC = insertSymbol.run('blobA', 5, 6, 'C', 'function', 'typescript', 'C', 'sig3').lastInsertRowid as number

    const insertSymEmb = session.rawDb.prepare(
      'INSERT INTO symbol_embeddings (symbol_id, model, dimensions, vector) VALUES (?, ?, ?, ?)',
    )
    insertSymEmb.run(symA, 'm', 4, bufFromArray([1, 0, 0, 0]))
    insertSymEmb.run(symB, 'm', 4, bufFromArray([0.9, 0.1, 0, 0]))
    insertSymEmb.run(symC, 'm', 4, bufFromArray([0, 1, 0, 0]))

    return fn(graph, session)
  })
}

describe('blastRadius (Phase 109)', () => {
  it('lens=structural returns only structural dependents', async () => {
    await withFusionGraph(async (graph) => {
      const result = await blastRadius(graph, 'C', { lens: 'structural', depth: 3 })
      expect(result.resolved.status).toBe('found')
      expect(result.structural.map((h) => h.displayName).sort()).toEqual(['A', 'B'])
      expect(result.semantic).toEqual([])
    })
  })

  it('lens=semantic returns only semantically related blobs/symbols', async () => {
    await withFusionGraph(async (graph) => {
      const result = await blastRadius(graph, 'C', { lens: 'semantic' })
      expect(result.resolved.status).toBe('found')
      expect(result.structural).toEqual([])
      expect(result.semanticSupported).toBe(true)
      // C's embedding [0,1,0,0] is closest to nothing in this fixture (A/B are
      // orthogonal-ish), but the call should still succeed and return hits sorted by score.
      expect(Array.isArray(result.semantic)).toBe(true)
    })
  })

  it('lens=hybrid (default) returns both structural and semantic sections', async () => {
    await withFusionGraph(async (graph) => {
      const result = await blastRadius(graph, 'C', { depth: 3 })
      expect(result.lens).toBe('hybrid')
      expect(result.structural.map((h) => h.displayName).sort()).toEqual(['A', 'B'])
      expect(result.semanticSupported).toBe(true)
    })
  })

  it('returns not-found for an unknown identifier', async () => {
    await withFusionGraph(async (graph) => {
      const result = await blastRadius(graph, 'does-not-exist')
      expect(result.resolved.status).toBe('not-found')
      expect(result.structural).toEqual([])
      expect(result.semantic).toEqual([])
    })
  })
})

describe('relate (Phase 109)', () => {
  it('returns depth-1 callers, callees, and semantically similar hits', async () => {
    await withFusionGraph(async (graph) => {
      const result = await relate(graph, 'B')
      expect(result.resolved.status).toBe('found')
      expect(result.callers.map((h) => h.displayName)).toEqual(['A'])
      expect(result.callees.map((h) => h.displayName)).toEqual(['C'])
      expect(result.semanticSupported).toBe(true)
      // B's embedding [0.9,0.1,0,0] is most similar to A's [1,0,0,0].
      expect(result.similar[0]?.symbolName).toBe('A')
    })
  })
})

describe('similar (Phase 109)', () => {
  it('lens=structural finds files with overlapping import targets', async () => {
    await withFusionGraph(async (graph) => {
      const result = await similar(graph, 'a.ts', { lens: 'structural' })
      expect(result.resolved.status).toBe('found')
      expect(result.structural.map((h) => h.displayName)).toEqual(['b.ts'])
      expect(result.structural[0].shared).toBe(1)
      expect(result.semantic).toEqual([])
    })
  })

  it('lens=semantic ranks by embedding similarity', async () => {
    await withFusionGraph(async (graph) => {
      const result = await similar(graph, 'A', { lens: 'semantic' })
      expect(result.resolved.status).toBe('found')
      expect(result.structural).toEqual([])
      expect(result.semanticSupported).toBe(true)
      expect(result.semantic[0]?.symbolName).toBe('B')
    })
  })
})

describe('unused (Phase 109)', () => {
  it('returns nodes with no inbound calls/imports edges', async () => {
    await withFusionGraph(async (graph) => {
      const result = await unused(graph)
      const keys = result.nodes.map((n) => n.nodeKey).sort()
      // A has no inbound calls/imports (only `defines`); file:a.ts/file:b.ts
      // have no inbound calls/imports either. B and C are `calls` targets, and
      // external:* nodes are excluded.
      expect(keys).toEqual(['file:a.ts', 'file:b.ts', 'symbol:a.ts#A#sig1'].sort())
    })
  })
})
