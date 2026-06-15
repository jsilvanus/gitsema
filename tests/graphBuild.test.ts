/**
 * Tests for the structural linking pass (Phase 107, knowledge-graph §3.3/§4/§5).
 *
 * Covers:
 *  1. Schema migration v25 -> v26 (graph_nodes + edges tables/indexes)
 *  2. Node/edge construction: file/symbol nodes, contains/defines edges
 *  3. Confidence-tier resolution: same-file, imported, project-wide-unique,
 *     ambiguous, and unresolved -> external
 *  4. co_change edges from blob_commits
 *  5. Idempotent rebuild (`gitsema graph build` run twice)
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runMigrations } from '../src/core/db/migrations/runner.js'
import { openDatabaseAt, withDbSession, type DbSession } from '../src/core/db/sqlite.js'
import { SqliteGraphStore } from '../src/core/storage/sqlite/profile.js'
import { buildGraph } from '../src/core/graph/build.js'

// ---------------------------------------------------------------------------
// Migration v25 -> v26
// ---------------------------------------------------------------------------

describe('schema migration v25 -> v26 (graph_nodes + edges tables)', () => {
  it('creates graph_nodes and edges tables and their indexes on an existing v25 database', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`
        CREATE TABLE blobs (
          blob_hash TEXT PRIMARY KEY,
          size INTEGER NOT NULL,
          indexed_at INTEGER NOT NULL
        );
        CREATE TABLE embeddings (
          blob_hash TEXT NOT NULL,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          vector BLOB NOT NULL,
          file_type TEXT,
          PRIMARY KEY (blob_hash, model)
        );
        CREATE TABLE structural_refs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
          enclosing_qualified_name TEXT,
          ref_kind TEXT NOT NULL,
          raw_target TEXT NOT NULL,
          target_module TEXT,
          line INTEGER NOT NULL
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta (key, value) VALUES ('schema_version', '25');
      `)

      runMigrations(sqlite)

      const tableNames = (sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('graph_nodes', 'edges')")
        .all() as Array<{ name: string }>).map((r) => r.name)
      expect(tableNames).toContain('graph_nodes')
      expect(tableNames).toContain('edges')

      const indexNames = (sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'edges'")
        .all() as Array<{ name: string }>).map((r) => r.name)
      expect(indexNames).toContain('idx_edges_src_type')
      expect(indexNames).toContain('idx_edges_dst_type')

      const version = sqlite.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }
      expect(parseInt(version.value, 10)).toBeGreaterThanOrEqual(26)
    } finally {
      sqlite.close()
    }
  })

  it('is idempotent when run twice', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`
        CREATE TABLE blobs (
          blob_hash TEXT PRIMARY KEY,
          size INTEGER NOT NULL,
          indexed_at INTEGER NOT NULL
        );
        CREATE TABLE embeddings (
          blob_hash TEXT NOT NULL,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          vector BLOB NOT NULL,
          file_type TEXT,
          PRIMARY KEY (blob_hash, model)
        );
        CREATE TABLE structural_refs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
          enclosing_qualified_name TEXT,
          ref_kind TEXT NOT NULL,
          raw_target TEXT NOT NULL,
          target_module TEXT,
          line INTEGER NOT NULL
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta (key, value) VALUES ('schema_version', '25');
      `)

      runMigrations(sqlite)
      runMigrations(sqlite)

      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'graph_nodes'")
        .all()
      expect(tables.length).toBe(1)
    } finally {
      sqlite.close()
    }
  })
})

// ---------------------------------------------------------------------------
// buildGraph fixture helpers
// ---------------------------------------------------------------------------

interface FixtureBlob {
  hash: string
  path: string
  timestamp: number
}

function setupFixtureDb(): { session: DbSession; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-graphbuild-'))
  const session = openDatabaseAt(join(tmpDir, 'test.db'))
  return { session, tmpDir }
}

function insertBlobAndPath(session: DbSession, blob: FixtureBlob): void {
  session.rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run(blob.hash, 100, Date.now())
  session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run(blob.hash, blob.path)
}

function insertCommit(session: DbSession, commitHash: string, timestamp: number, blobHashes: string[]): void {
  session.rawDb
    .prepare('INSERT OR IGNORE INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)')
    .run(commitHash, timestamp, 'fixture commit')
  for (const blobHash of blobHashes) {
    session.rawDb
      .prepare('INSERT OR IGNORE INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)')
      .run(blobHash, commitHash)
  }
}

function insertSymbol(
  session: DbSession,
  args: {
    blobHash: string
    symbolName: string
    symbolKind: string
    qualifiedName: string
    signatureHash: string
    parentQualifiedName?: string | null
  },
): void {
  session.rawDb
    .prepare(
      `INSERT INTO symbols (blob_hash, start_line, end_line, symbol_name, symbol_kind, language, qualified_name, signature, signature_hash, parent_qualified_name)
       VALUES (?, 1, 10, ?, ?, 'typescript', ?, '()', ?, ?)`,
    )
    .run(args.blobHash, args.symbolName, args.symbolKind, args.qualifiedName, args.signatureHash, args.parentQualifiedName ?? null)
}

function insertStructuralRef(
  session: DbSession,
  args: {
    blobHash: string
    enclosingQualifiedName?: string | null
    refKind: string
    rawTarget: string
    targetModule?: string | null
    line?: number
  },
): void {
  session.rawDb
    .prepare(
      `INSERT INTO structural_refs (blob_hash, enclosing_qualified_name, ref_kind, raw_target, target_module, line)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(args.blobHash, args.enclosingQualifiedName ?? null, args.refKind, args.rawTarget, args.targetModule ?? null, args.line ?? 1)
}

function getNode(session: DbSession, nodeKey: string): Record<string, unknown> | undefined {
  return session.rawDb.prepare('SELECT * FROM graph_nodes WHERE node_key = ?').get(nodeKey) as
    | Record<string, unknown>
    | undefined
}

function getEdges(session: DbSession, srcKey: string, dstKey: string, edgeType: string): Record<string, unknown>[] {
  return session.rawDb
    .prepare('SELECT * FROM edges WHERE src_key = ? AND dst_key = ? AND edge_type = ?')
    .all(srcKey, dstKey, edgeType) as Record<string, unknown>[]
}

// ---------------------------------------------------------------------------
// Node / edge construction + confidence-tier resolution
// ---------------------------------------------------------------------------

describe('buildGraph — node/edge construction and confidence tiers', () => {
  it('builds file and symbol nodes with contains/defines edges', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        insertBlobAndPath(session, { hash: 'a'.repeat(40), path: 'src/a.ts', timestamp: 100 })
        insertCommit(session, 'commit1', 100, ['a'.repeat(40)])

        insertSymbol(session, {
          blobHash: 'a'.repeat(40),
          symbolName: 'Sub',
          symbolKind: 'class',
          qualifiedName: 'Sub',
          signatureHash: 'sigsub00001',
        })
        insertSymbol(session, {
          blobHash: 'a'.repeat(40),
          symbolName: 'method',
          symbolKind: 'method',
          qualifiedName: 'Sub.method',
          signatureHash: 'sigmeth0001',
          parentQualifiedName: 'Sub',
        })

        const graph = new SqliteGraphStore()
        const result = await buildGraph(graph)
        expect(result.nodeCount).toBeGreaterThan(0)
        expect(result.edgeCount).toBeGreaterThan(0)

        const fileNode = getNode(session, 'file:src/a.ts')
        expect(fileNode).toBeDefined()
        expect(fileNode!.kind).toBe('file')

        const classNode = getNode(session, 'symbol:src/a.ts#Sub#sigsub00001')
        expect(classNode).toBeDefined()
        expect(classNode!.kind).toBe('class')

        const methodNode = getNode(session, 'symbol:src/a.ts#Sub.method#sigmeth0001')
        expect(methodNode).toBeDefined()

        // file -> class: defines + contains (no parent)
        expect(getEdges(session, 'file:src/a.ts', 'symbol:src/a.ts#Sub#sigsub00001', 'defines').length).toBe(1)
        expect(getEdges(session, 'file:src/a.ts', 'symbol:src/a.ts#Sub#sigsub00001', 'contains').length).toBe(1)

        // file -> method: defines; Sub -> method: contains (has parent)
        expect(getEdges(session, 'file:src/a.ts', 'symbol:src/a.ts#Sub.method#sigmeth0001', 'defines').length).toBe(1)
        expect(getEdges(session, 'symbol:src/a.ts#Sub#sigsub00001', 'symbol:src/a.ts#Sub.method#sigmeth0001', 'contains').length).toBe(1)
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('resolves a same-file call target with confidence 1.0', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        const blob = 'b'.repeat(40)
        insertBlobAndPath(session, { hash: blob, path: 'src/b.ts', timestamp: 100 })
        insertCommit(session, 'commit1', 100, [blob])

        insertSymbol(session, { blobHash: blob, symbolName: 'helper', symbolKind: 'function', qualifiedName: 'helper', signatureHash: 'sighelper01' })
        insertSymbol(session, { blobHash: blob, symbolName: 'topLevel', symbolKind: 'function', qualifiedName: 'topLevel', signatureHash: 'sigtop00001' })
        insertStructuralRef(session, { blobHash: blob, enclosingQualifiedName: 'topLevel', refKind: 'call', rawTarget: 'helper' })

        const graph = new SqliteGraphStore()
        await buildGraph(graph)

        const callEdges = getEdges(session, 'symbol:src/b.ts#topLevel#sigtop00001', 'symbol:src/b.ts#helper#sighelper01', 'calls')
        expect(callEdges.length).toBe(1)
        expect(callEdges[0].confidence).toBe(1)
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('resolves an imported call target with confidence 0.9 and adds an imports edge', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        const aBlob = 'c'.repeat(40)
        const bBlob = 'd'.repeat(40)
        insertBlobAndPath(session, { hash: aBlob, path: 'src/a.ts', timestamp: 100 })
        insertBlobAndPath(session, { hash: bBlob, path: 'src/b.ts', timestamp: 100 })
        insertCommit(session, 'commit1', 100, [aBlob, bBlob])

        insertSymbol(session, { blobHash: aBlob, symbolName: 'helper', symbolKind: 'function', qualifiedName: 'helper', signatureHash: 'sighelper02' })
        insertSymbol(session, { blobHash: bBlob, symbolName: 'caller', symbolKind: 'function', qualifiedName: 'caller', signatureHash: 'sigcaller01' })

        // b.ts imports helper from ./a and calls it
        insertStructuralRef(session, { blobHash: bBlob, refKind: 'import', rawTarget: 'helper', targetModule: './a' })
        insertStructuralRef(session, { blobHash: bBlob, enclosingQualifiedName: 'caller', refKind: 'call', rawTarget: 'helper' })

        const graph = new SqliteGraphStore()
        await buildGraph(graph)

        // imports edge: b.ts -> a.ts (confidence 1.0, ref_kind = import)
        const importEdges = getEdges(session, 'file:src/b.ts', 'file:src/a.ts', 'imports')
        expect(importEdges.length).toBe(1)

        // calls edge: caller -> helper (confidence 0.9, "imported" tier)
        const callEdges = getEdges(session, 'symbol:src/b.ts#caller#sigcaller01', 'symbol:src/a.ts#helper#sighelper02', 'calls')
        expect(callEdges.length).toBe(1)
        expect(callEdges[0].confidence).toBeCloseTo(0.9)
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('resolves a project-wide-unique call target with confidence 0.6', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        const aBlob = 'e'.repeat(40)
        const bBlob = 'f'.repeat(40)
        insertBlobAndPath(session, { hash: aBlob, path: 'src/a.ts', timestamp: 100 })
        insertBlobAndPath(session, { hash: bBlob, path: 'src/b.ts', timestamp: 100 })
        insertCommit(session, 'commit1', 100, [aBlob, bBlob])

        // 'uniqueFn' is defined exactly once in the whole project, in a.ts
        insertSymbol(session, { blobHash: aBlob, symbolName: 'uniqueFn', symbolKind: 'function', qualifiedName: 'uniqueFn', signatureHash: 'siguniq0001' })
        insertSymbol(session, { blobHash: bBlob, symbolName: 'caller', symbolKind: 'function', qualifiedName: 'caller', signatureHash: 'sigcaller02' })

        // b.ts calls uniqueFn without importing it
        insertStructuralRef(session, { blobHash: bBlob, enclosingQualifiedName: 'caller', refKind: 'call', rawTarget: 'uniqueFn' })

        const graph = new SqliteGraphStore()
        await buildGraph(graph)

        const callEdges = getEdges(session, 'symbol:src/b.ts#caller#sigcaller02', 'symbol:src/a.ts#uniqueFn#siguniq0001', 'calls')
        expect(callEdges.length).toBe(1)
        expect(callEdges[0].confidence).toBeCloseTo(0.6)
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('resolves an ambiguous call target with confidence 0.3, picking the nearer candidate', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        const nearBlob = 'a1'.padEnd(40, '0')
        const farBlob = 'b1'.padEnd(40, '0')
        const callerBlob = 'c1'.padEnd(40, '0')

        insertBlobAndPath(session, { hash: nearBlob, path: 'src/util/run.ts', timestamp: 100 })
        insertBlobAndPath(session, { hash: farBlob, path: 'lib/other/run.ts', timestamp: 100 })
        insertBlobAndPath(session, { hash: callerBlob, path: 'src/util/caller.ts', timestamp: 100 })
        insertCommit(session, 'commit1', 100, [nearBlob, farBlob, callerBlob])

        // Two unrelated 'run' functions in different directories
        insertSymbol(session, { blobHash: nearBlob, symbolName: 'run', symbolKind: 'function', qualifiedName: 'run', signatureHash: 'signear00001' })
        insertSymbol(session, { blobHash: farBlob, symbolName: 'run', symbolKind: 'function', qualifiedName: 'run', signatureHash: 'sigfar000001' })
        insertSymbol(session, { blobHash: callerBlob, symbolName: 'caller', symbolKind: 'function', qualifiedName: 'caller', signatureHash: 'sigcaller03' })

        insertStructuralRef(session, { blobHash: callerBlob, enclosingQualifiedName: 'caller', refKind: 'call', rawTarget: 'run' })

        const graph = new SqliteGraphStore()
        await buildGraph(graph)

        // The nearer candidate (src/util/run.ts, same directory as caller) should win
        const nearEdges = getEdges(session, 'symbol:src/util/caller.ts#caller#sigcaller03', 'symbol:src/util/run.ts#run#signear00001', 'calls')
        const farEdges = getEdges(session, 'symbol:src/util/caller.ts#caller#sigcaller03', 'symbol:lib/other/run.ts#run#sigfar000001', 'calls')
        expect(nearEdges.length).toBe(1)
        expect(nearEdges[0].confidence).toBeCloseTo(0.3)
        expect(farEdges.length).toBe(0)
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('resolves an unresolved call target to an external node with confidence 0', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        const blob = '1'.padEnd(40, '1')
        insertBlobAndPath(session, { hash: blob, path: 'src/main.ts', timestamp: 100 })
        insertCommit(session, 'commit1', 100, [blob])

        insertSymbol(session, { blobHash: blob, symbolName: 'main', symbolKind: 'function', qualifiedName: 'main', signatureHash: 'sigmain0001' })
        insertStructuralRef(session, { blobHash: blob, enclosingQualifiedName: 'main', refKind: 'call', rawTarget: 'externalLibFn' })

        const graph = new SqliteGraphStore()
        await buildGraph(graph)

        const externalNode = getNode(session, 'external:externalLibFn')
        expect(externalNode).toBeDefined()
        expect(externalNode!.is_external).toBe(1)

        const edges = getEdges(session, 'symbol:src/main.ts#main#sigmain0001', 'external:externalLibFn', 'calls')
        expect(edges.length).toBe(1)
        expect(edges[0].confidence).toBe(0)
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// co_change edges
// ---------------------------------------------------------------------------

describe('buildGraph — co_change edges', () => {
  it('creates bidirectional co_change edges weighted by co-occurrence count', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        const aBlob1 = '2'.padEnd(40, '2')
        const bBlob1 = '3'.padEnd(40, '3')
        const aBlob2 = '4'.padEnd(40, '4')
        const bBlob2 = '5'.padEnd(40, '5')

        insertBlobAndPath(session, { hash: aBlob1, path: 'src/a.ts', timestamp: 100 })
        insertBlobAndPath(session, { hash: bBlob1, path: 'src/b.ts', timestamp: 100 })
        insertBlobAndPath(session, { hash: aBlob2, path: 'src/a.ts', timestamp: 200 })
        insertBlobAndPath(session, { hash: bBlob2, path: 'src/b.ts', timestamp: 200 })

        // Two commits, each touching both a.ts and b.ts
        insertCommit(session, 'commit1', 100, [aBlob1, bBlob1])
        insertCommit(session, 'commit2', 200, [aBlob2, bBlob2])

        const graph = new SqliteGraphStore()
        await buildGraph(graph)

        const ab = getEdges(session, 'file:src/a.ts', 'file:src/b.ts', 'co_change')
        const ba = getEdges(session, 'file:src/b.ts', 'file:src/a.ts', 'co_change')
        expect(ab.length).toBe(1)
        expect(ba.length).toBe(1)
        expect(ab[0].weight).toBe(2)
        expect(ab[0].observed_count).toBe(2)
        expect(ab[0].first_seen_commit).toBe('commit1')
        expect(ab[0].last_seen_commit).toBe('commit2')
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('skips commits touching more than CO_CHANGE_MAX_FILES_PER_COMMIT distinct files', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        const blobHashes: string[] = []
        for (let i = 0; i < 51; i++) {
          const hash = `f${i.toString().padStart(3, '0')}`.padEnd(40, 'a')
          insertBlobAndPath(session, { hash, path: `src/file${i}.ts`, timestamp: 100 })
          blobHashes.push(hash)
        }
        insertCommit(session, 'commit1', 100, blobHashes)

        const graph = new SqliteGraphStore()
        await buildGraph(graph)

        const ab = getEdges(session, 'file:src/file0.ts', 'file:src/file1.ts', 'co_change')
        expect(ab.length).toBe(0)
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Idempotent rebuild
// ---------------------------------------------------------------------------

describe('buildGraph — idempotent rebuild', () => {
  it('produces the same node/edge counts when run twice', async () => {
    const { session, tmpDir } = setupFixtureDb()
    try {
      await withDbSession(session, async () => {
        const aBlob = '6'.padEnd(40, '6')
        const bBlob = '7'.padEnd(40, '7')
        insertBlobAndPath(session, { hash: aBlob, path: 'src/a.ts', timestamp: 100 })
        insertBlobAndPath(session, { hash: bBlob, path: 'src/b.ts', timestamp: 100 })
        insertCommit(session, 'commit1', 100, [aBlob, bBlob])

        insertSymbol(session, { blobHash: aBlob, symbolName: 'helper', symbolKind: 'function', qualifiedName: 'helper', signatureHash: 'sighelper03' })
        insertStructuralRef(session, { blobHash: bBlob, refKind: 'import', rawTarget: 'helper', targetModule: './a' })

        const graph = new SqliteGraphStore()
        const first = await buildGraph(graph)
        const second = await buildGraph(graph)

        expect(second.nodeCount).toBe(first.nodeCount)
        expect(second.edgeCount).toBe(first.edgeCount)

        const nodeCount = (session.rawDb.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }).n
        const edgeCount = (session.rawDb.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number }).n
        expect(nodeCount).toBe(first.nodeCount)
        expect(edgeCount).toBe(first.edgeCount)
      })
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
