/**
 * SQLite-backed implementation of the storage seam (Phase 101).
 *
 * Each store delegates to the existing synchronous better-sqlite3 code via the
 * active DbSession, wrapped in resolved promises. The stores are stateless and
 * resolve `getActiveSession()` lazily on every call, so they cooperate with
 * `withDbSession()` contexts exactly like the rest of the codebase. This means
 * adopting the seam in a call site is behavior-preserving.
 */

import { getActiveSession } from '../../db/sqlite.js'
import { embeddings, paths, blobs, commits, blobCommits, indexedCommits, blobBranches, chunks, chunkEmbeddings, symbols, symbolEmbeddings, moduleEmbeddings, commitEmbeddings, graphNodes, edges } from '../../db/schema.js'
import { eq, inArray, sql } from 'drizzle-orm'
import { isIndexed as dedupeIsIndexed, filterNewBlobs as dedupeFilterNewBlobs } from '../../indexing/deduper.js'
import {
  storeFtsContent, getBlobContent, storeBlob, storeBlobRecord,
  storeCommitWithBlobs, markCommitIndexed as sqliteMarkCommitIndexed,
  getLastIndexedCommit as sqliteGetLastIndexedCommit, storeBlobBranches,
  storeChunk, storeSymbol, storeModuleEmbedding, storeCommitEmbedding,
  storeStructuralRefs as sqliteStoreStructuralRefs,
  serializeEmbedding,
} from '../../indexing/blobStore.js'
import { vectorSearch, type VectorSearchOptions } from '../../search/analysis/vectorSearch.js'
import { searchCommits, type CommitSearchOptions, type CommitSearchResult } from '../../search/commitSearch.js'
import type { Embedding, SearchResult } from '../../models/types.js'
import type { CommitEntry } from '../../git/commitMap.js'
import type {
  Bm25Hit,
  EdgeType,
  FtsStore,
  GraphEdgeRecord,
  GraphNodeRecord,
  GraphStore,
  MetadataStore,
  StorageProfile,
  StorageScope,
  StorageStats,
  StructuralRefRecord,
  VectorKind,
  VectorRecord,
  VectorStore,
  WriteBlobRecordArgs,
  WriteFileBlobArgs,
} from '../types.js'

class SqliteMetadataStore implements MetadataStore {
  async isIndexed(blobHash: string, model: string): Promise<boolean> {
    return dedupeIsIndexed(blobHash, model)
  }

  async filterNewBlobs(hashes: string[], model: string): Promise<Set<string>> {
    return dedupeFilterNewBlobs(hashes, model)
  }

  async pathsFor(blobHashes: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    if (blobHashes.length === 0) return result
    const { db } = getActiveSession()
    const BATCH = 500
    for (let i = 0; i < blobHashes.length; i += BATCH) {
      const batch = blobHashes.slice(i, i + BATCH)
      const rows = db
        .select({ blobHash: paths.blobHash, path: paths.path })
        .from(paths)
        .where(inArray(paths.blobHash, batch))
        .all()
      for (const row of rows) {
        const list = result.get(row.blobHash) ?? []
        list.push(row.path)
        result.set(row.blobHash, list)
      }
    }
    return result
  }

  async putBlob(blobHash: string, size: number): Promise<void> {
    const { db } = getActiveSession()
    db.insert(blobs).values({ blobHash, size, indexedAt: Date.now() }).onConflictDoNothing().run()
  }

  async addPath(blobHash: string, path: string): Promise<void> {
    const { db } = getActiveSession()
    db.insert(paths).values({ blobHash, path }).onConflictDoNothing().run()
  }

  async putCommit(commit: CommitEntry): Promise<void> {
    const { db } = getActiveSession()
    db.insert(commits)
      .values({ commitHash: commit.commitHash, timestamp: commit.timestamp, message: commit.message, authorName: commit.authorName ?? null, authorEmail: commit.authorEmail ?? null })
      .onConflictDoNothing()
      .run()
  }

  async linkBlobCommits(commitHash: string, blobHashes: string[]): Promise<number> {
    const { db } = getActiveSession()
    const uniqueHashes = [...new Set(blobHashes)]
    if (uniqueHashes.length === 0) return 0

    // Only link blobs that are already indexed (mirrors storeCommitWithBlobs).
    const BATCH = 500
    const indexedSet = new Set<string>()
    for (let i = 0; i < uniqueHashes.length; i += BATCH) {
      const batch = uniqueHashes.slice(i, i + BATCH)
      const rows = db.select({ blobHash: blobs.blobHash }).from(blobs).where(inArray(blobs.blobHash, batch)).all()
      for (const row of rows) indexedSet.add(row.blobHash)
    }

    let linked = 0
    for (const blobHash of uniqueHashes) {
      if (!indexedSet.has(blobHash)) continue
      const res = db.insert(blobCommits).values({ blobHash, commitHash }).onConflictDoNothing().run()
      if (res.changes > 0) linked++
    }
    return linked
  }

  async setBlobBranches(blobHash: string, branches: string[]): Promise<void> {
    storeBlobBranches(blobHash, branches)
  }

  async markCommitIndexed(commitHash: string): Promise<void> {
    sqliteMarkCommitIndexed(commitHash)
  }

  async getLastIndexedCommit(): Promise<string | undefined> {
    return sqliteGetLastIndexedCommit()
  }

  async getStats(): Promise<StorageStats> {
    const { db } = getActiveSession()
    const blobCount = db.select({ n: sql<number>`count(*)` }).from(blobs).get()?.n ?? 0
    const pathCount = db.select({ n: sql<number>`count(*)` }).from(paths).get()?.n ?? 0
    const commitCount = db.select({ n: sql<number>`count(*)` }).from(commits).get()?.n ?? 0
    const indexedCommitCount = db.select({ n: sql<number>`count(*)` }).from(indexedCommits).get()?.n ?? 0
    const branchCount = db.select({ n: sql<number>`count(distinct branch_name)` }).from(blobBranches).get()?.n ?? 0
    const lastIndexedCommit = await sqliteGetLastIndexedCommit()
    return { blobCount, pathCount, commitCount, indexedCommitCount, branchCount, lastIndexedCommit }
  }

  async storeStructuralRefs(blobHash: string, refs: StructuralRefRecord[]): Promise<void> {
    sqliteStoreStructuralRefs(blobHash, refs)
  }
}

// NOTE: this adapter intentionally delegates back to the free `vectorSearch` /
// `searchCommits` functions, which hold the actual sqlite implementation. Those
// functions short-circuit when `profile.backend === 'sqlite'` *before*
// re-entering the store, so this delegation does not recurse. Do not add real
// query logic here that calls back into those functions without that guard.
class SqliteVectorStore implements VectorStore {
  async search(queryEmbedding: Embedding, options: VectorSearchOptions = {}): Promise<SearchResult[]> {
    return await vectorSearch(queryEmbedding, options)
  }

  async searchCommits(queryEmbedding: Embedding, options: CommitSearchOptions = {}): Promise<CommitSearchResult[]> {
    return await searchCommits(queryEmbedding, options)
  }

  async countFileEmbeddings(model?: string): Promise<number> {
    const { db } = getActiveSession()
    const base = db.select({ n: sql<number>`count(*)` }).from(embeddings)
    const row = model ? base.where(eq(embeddings.model, model)).get() : base.get()
    return row?.n ?? 0
  }

  async upsert(kind: VectorKind, items: VectorRecord[]): Promise<void> {
    const { db } = getActiveSession()
    for (const item of items) {
      switch (kind) {
        case 'file': {
          const { vector, quantized, quantMin, quantScale } = serializeEmbedding(item.embedding, item.quantize)
          db.insert(embeddings)
            .values({ blobHash: item.id, model: item.model, dimensions: item.embedding.length, vector, quantized, quantMin, quantScale })
            .onConflictDoNothing()
            .run()
          break
        }
        case 'chunk':
          storeChunk({
            blobHash: item.id,
            startLine: item.startLine ?? 0,
            endLine: item.endLine ?? 0,
            model: item.model,
            embedding: item.embedding,
            quantize: item.quantize,
          })
          break
        case 'symbol':
          storeSymbol({
            blobHash: item.id,
            startLine: item.startLine ?? 0,
            endLine: item.endLine ?? 0,
            symbolName: item.symbolName ?? '',
            symbolKind: item.symbolKind ?? 'other',
            language: item.language ?? 'unknown',
            model: item.model,
            embedding: item.embedding,
            quantize: item.quantize,
            qualifiedName: item.qualifiedName,
            signature: item.signature,
            signatureHash: item.signatureHash,
            parentQualifiedName: item.parentQualifiedName,
          })
          break
        case 'module':
          storeModuleEmbedding({
            modulePath: item.id,
            model: item.model,
            embedding: item.embedding,
            blobCount: item.blobCount ?? 1,
          })
          break
        case 'commit':
          storeCommitEmbedding({
            commitHash: item.id,
            model: item.model,
            embedding: item.embedding,
            quantize: item.quantize,
          })
          break
      }
    }
  }

  async delete(kind: VectorKind, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const { db } = getActiveSession()
    switch (kind) {
      case 'file':
        db.delete(embeddings).where(inArray(embeddings.blobHash, ids)).run()
        break
      case 'chunk': {
        const chunkRows = db.select({ id: chunks.id }).from(chunks).where(inArray(chunks.blobHash, ids)).all()
        const chunkIds = chunkRows.map((r) => r.id)
        if (chunkIds.length > 0) db.delete(chunkEmbeddings).where(inArray(chunkEmbeddings.chunkId, chunkIds)).run()
        db.delete(chunks).where(inArray(chunks.blobHash, ids)).run()
        break
      }
      case 'symbol': {
        const symbolRows = db.select({ id: symbols.id }).from(symbols).where(inArray(symbols.blobHash, ids)).all()
        const symbolIds = symbolRows.map((r) => r.id)
        if (symbolIds.length > 0) db.delete(symbolEmbeddings).where(inArray(symbolEmbeddings.symbolId, symbolIds)).run()
        db.delete(symbols).where(inArray(symbols.blobHash, ids)).run()
        break
      }
      case 'module':
        db.delete(moduleEmbeddings).where(inArray(moduleEmbeddings.modulePath, ids)).run()
        break
      case 'commit':
        db.delete(commitEmbeddings).where(inArray(commitEmbeddings.commitHash, ids)).run()
        break
    }
  }
}

class SqliteFtsStore implements FtsStore {
  async index(blobHash: string, content: string): Promise<void> {
    storeFtsContent(blobHash, content)
  }

  async get(blobHash: string): Promise<string | undefined> {
    return getBlobContent(blobHash)
  }

  async search(query: string, limit: number): Promise<Bm25Hit[]> {
    const { rawDb } = getActiveSession()
    try {
      const rows = rawDb
        .prepare(
          `SELECT blob_hash, bm25(blob_fts) AS bm25_score
           FROM blob_fts
           WHERE blob_fts MATCH ?
           ORDER BY bm25_score
           LIMIT ?`,
        )
        .all(sanitizeFtsQuery(query), limit) as Array<{ blob_hash: string; bm25_score: number }>
      return rows.map((r) => ({ blobHash: r.blob_hash, score: r.bm25_score }))
    } catch {
      // FTS5 unavailable or query un-parseable — treat as no keyword hits.
      return []
    }
  }

  async delete(blobHashes: string[]): Promise<void> {
    if (blobHashes.length === 0) return
    const { rawDb } = getActiveSession()
    const stmt = rawDb.prepare('DELETE FROM blob_fts WHERE blob_hash = ?')
    const tx = rawDb.transaction((hashes: string[]) => {
      for (const h of hashes) stmt.run(h)
    })
    tx(blobHashes)
  }
}

/**
 * Builds an FTS5 MATCH expression from a free-text query by quoting each token
 * as a phrase (mirrors the sanitisation used by the existing hybrid search).
 */
export function sanitizeFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ')
}

/**
 * SQLite-backed `GraphStore` (Phase 107). `replaceAll` truncates and
 * rebuilds `graph_nodes`/`edges` in one transaction — the same
 * truncate-and-rebuild discipline used for `blob_clusters`.
 */
export class SqliteGraphStore implements GraphStore {
  async replaceAll(nodes: GraphNodeRecord[], edgeRecords: GraphEdgeRecord[]): Promise<void> {
    const { db, rawDb } = getActiveSession()
    const tx = rawDb.transaction(() => {
      rawDb.prepare('DELETE FROM edges').run()
      rawDb.prepare('DELETE FROM graph_nodes').run()

      const BATCH = 500
      for (let i = 0; i < nodes.length; i += BATCH) {
        const batch = nodes.slice(i, i + BATCH)
        db.insert(graphNodes).values(batch.map((n) => ({
          nodeKey: n.nodeKey,
          kind: n.kind,
          displayName: n.displayName,
          path: n.path ?? null,
          repoId: n.repoId ?? null,
          currentBlobHash: n.currentBlobHash ?? null,
          isExternal: n.isExternal ? 1 : 0,
        }))).run()
      }

      for (let i = 0; i < edgeRecords.length; i += BATCH) {
        const batch = edgeRecords.slice(i, i + BATCH)
        db.insert(edges).values(batch.map((e) => ({
          srcKey: e.srcKey,
          dstKey: e.dstKey,
          edgeType: e.edgeType,
          weight: e.weight ?? 1,
          confidence: e.confidence ?? 1,
          firstSeenCommit: e.firstSeenCommit ?? null,
          lastSeenCommit: e.lastSeenCommit ?? null,
          observedCount: e.observedCount ?? 1,
        }))).run()
      }
    })
    tx()
  }

  async countNodes(): Promise<number> {
    const { rawDb } = getActiveSession()
    const row = rawDb.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }
    return row.n
  }

  async countEdges(): Promise<number> {
    const { rawDb } = getActiveSession()
    const row = rawDb.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number }
    return row.n
  }

  async getNode(nodeKey: string): Promise<GraphNodeRecord | undefined> {
    const { db } = getActiveSession()
    const row = db.select().from(graphNodes).where(eq(graphNodes.nodeKey, nodeKey)).get()
    return row ? rowToNode(row) : undefined
  }

  async allNodes(): Promise<GraphNodeRecord[]> {
    const { db } = getActiveSession()
    return db.select().from(graphNodes).all().map(rowToNode)
  }

  async allEdges(edgeTypes?: EdgeType[]): Promise<GraphEdgeRecord[]> {
    const { db } = getActiveSession()
    const rows = edgeTypes && edgeTypes.length > 0
      ? db.select().from(edges).where(inArray(edges.edgeType, edgeTypes)).all()
      : db.select().from(edges).all()
    return rows.map(rowToEdge)
  }

  async edgesFor(nodeKey: string, opts?: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both' }): Promise<GraphEdgeRecord[]> {
    const { db } = getActiveSession()
    const direction = opts?.direction ?? 'both'
    const edgeTypes = opts?.edgeTypes

    const collected: GraphEdgeRecord[] = []
    if (direction === 'out' || direction === 'both') {
      const rows = db.select().from(edges).where(eq(edges.srcKey, nodeKey)).all()
      for (const r of rows) collected.push(rowToEdge(r))
    }
    if (direction === 'in' || direction === 'both') {
      const rows = db.select().from(edges).where(eq(edges.dstKey, nodeKey)).all()
      for (const r of rows) collected.push(rowToEdge(r))
    }
    return edgeTypes && edgeTypes.length > 0
      ? collected.filter((e) => edgeTypes.includes(e.edgeType))
      : collected
  }
}

function rowToNode(row: typeof graphNodes.$inferSelect): GraphNodeRecord {
  return {
    nodeKey: row.nodeKey,
    kind: row.kind,
    displayName: row.displayName,
    path: row.path ?? undefined,
    repoId: row.repoId ?? undefined,
    currentBlobHash: row.currentBlobHash ?? undefined,
    isExternal: !!row.isExternal,
  }
}

function rowToEdge(row: typeof edges.$inferSelect): GraphEdgeRecord {
  return {
    srcKey: row.srcKey,
    dstKey: row.dstKey,
    edgeType: row.edgeType as EdgeType,
    weight: row.weight ?? 1,
    confidence: row.confidence ?? 1,
    firstSeenCommit: row.firstSeenCommit ?? undefined,
    lastSeenCommit: row.lastSeenCommit ?? undefined,
    observedCount: row.observedCount ?? 1,
  }
}

/**
 * A SQLite storage profile. The three stores share the active DbSession, so
 * wrapping calls in `withStorageProfile()` (which activates the profile's
 * database) routes all three to the same SQLite file.
 */
export class SqliteStorageProfile implements StorageProfile {
  readonly backend = 'sqlite' as const
  readonly metadata: MetadataStore = new SqliteMetadataStore()
  readonly vectors: VectorStore = new SqliteVectorStore()
  readonly fts: FtsStore | null
  readonly graph: GraphStore = new SqliteGraphStore()

  constructor(
    readonly scope: StorageScope,
    readonly location: string,
    ftsEnabled = true,
  ) {
    this.fts = ftsEnabled ? new SqliteFtsStore() : null
  }

  async writeFileBlob(args: WriteFileBlobArgs): Promise<void> {
    // storeBlob writes blob + embedding + path + FTS content in one SQLite
    // transaction — already the atomic cross-store write for this backend.
    storeBlob(args)
  }

  async writeBlobRecord(args: WriteBlobRecordArgs): Promise<void> {
    storeBlobRecord(args)
  }
}
