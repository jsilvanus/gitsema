/**
 * Qdrant-backed `VectorStore` (Phase 103).
 *
 * Qdrant holds vectors + a small payload (see docs/storage-backends-plan.md
 * §6.5: `blob_hash`, `model`, and chunk/symbol metadata). Everything
 * relational — paths, commit graph, branch membership — stays in the
 * Postgres companion (`PostgresMetadataStore`'s pool, reused here read-only
 * for joins) and is fetched by `blob_hash` after the ANN search, mirroring
 * `PgVectorStore`'s "wide pool + JS re-rank" pattern.
 *
 * Collections are named `gitsema_<kind>_<model>_<dimensions>` and created
 * lazily on first upsert — Qdrant requires a fixed vector size per
 * collection, so each (kind, model, dimensions) tuple gets its own.
 *
 * Deviations from the idealized payload design (documented in PLAN.md):
 *  - `first_seen` is NOT denormalized into the payload; `--before`/`--after`
 *    and `--branch` filtering both post-filter a wide candidate pool against
 *    the Postgres companion's `blob_commits`/`blob_branches` tables, exactly
 *    like `PgVectorStore`.
 *  - `chunk`/`symbol` points are identified by a deterministic UUID derived
 *    from `(blobHash, startLine, endLine, ...)`; there is no integer FK back
 *    to a `chunks`/`symbols` row (those tables are unused for this backend).
 */

import { createHash } from 'node:crypto'
import type { QdrantClient } from '@qdrant/js-client-rest'
import { verifyQdrantClient } from './connection.js'
import { scoreAndDedupe, type RerankCandidate } from '../rerank.js'
import type { Pool } from 'pg'
import type { Embedding, SearchResult, SearchResultKind } from '../../models/types.js'
import { pathRelevanceScore, type VectorSearchOptions } from '../../search/analysis/vectorSearch.js'
import { computeRecencyScores, type FirstSeenInfo } from '../../search/temporal/timeSearch.js'
import type { CommitSearchOptions, CommitSearchResult } from '../../search/commitSearch.js'
import type { VectorKind, VectorRecord, VectorStore } from '../types.js'

/** Deterministic UUID (v5-shaped) derived from `key`, for use as a Qdrant point id. */
function toPointId(key: string): string {
  const hex = createHash('sha1').update(key).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** Sanitizes a model name for use in a Qdrant collection name. */
function sanitizeModel(model: string): string {
  return model.replace(/[^A-Za-z0-9_-]/g, '_')
}

function collectionName(kind: VectorKind, model: string, dimensions: number): string {
  return `gitsema_${kind}_${sanitizeModel(model)}_${dimensions}`
}

type FileCandidate = RerankCandidate

export class QdrantVectorStore implements VectorStore {
  constructor(
    private readonly client: QdrantClient,
    /** Postgres companion pool, used read-only for path/commit/branch joins. */
    private readonly pool: Pool,
  ) {}

  private async ensureCollection(name: string, dimensions: number): Promise<void> {
    const { collections } = await this.client.getCollections()
    if (collections.some((c) => c.name === name)) return
    await this.client.createCollection(name, {
      vectors: { size: dimensions, distance: 'Cosine' },
    })
  }

  /** Lists existing collections for `kind` (and, if given, `model`/`dimensions`). */
  private async listCollections(kind: VectorKind, model?: string, dimensions?: number): Promise<string[]> {
    if (model && dimensions !== undefined) {
      const name = collectionName(kind, model, dimensions)
      const { collections } = await this.client.getCollections()
      return collections.some((c) => c.name === name) ? [name] : []
    }
    const { collections } = await this.client.getCollections()
    const prefix = `gitsema_${kind}_`
    const suffix = dimensions !== undefined ? `_${dimensions}` : undefined
    return collections
      .map((c) => c.name)
      .filter((n) => n.startsWith(prefix) && (!suffix || n.endsWith(suffix)))
  }

  async countFileEmbeddings(model?: string): Promise<number> {
    let total = 0
    const names = model
      ? (await this.listCollections('file')).filter((n) => n.startsWith(`gitsema_file_${sanitizeModel(model)}_`))
      : await this.listCollections('file')
    for (const name of names) {
      const { count } = await this.client.count(name, { exact: true })
      total += count
    }
    return total
  }

  async search(queryEmbedding: Embedding, options: VectorSearchOptions = {}): Promise<SearchResult[]> {
    // Fail loudly on options this backend cannot honor, rather than silently
    // returning wrong results (review9 §4).
    if (options.allowedHashes && options.allowedHashes.size > 0) {
      throw new Error(
        'qdrant vector backend does not support allowedHashes candidate filtering ' +
        '(used by boolean and negative-example search); run these queries on the sqlite backend',
      )
    }
    if (options.negativeQueryEmbedding) {
      throw new Error(
        'qdrant vector backend does not support negative-example search; ' +
        'use the sqlite or postgres backend',
      )
    }
    await verifyQdrantClient(this.client)
    const {
      topK = 10, model, recent = false, alpha = 0.8, before, after,
      weightVector, weightRecency, weightPath, query = '',
      searchChunks = false, searchSymbols = false, searchModules = false, branch,
      explain,
    } = options

    const useThreeSignal = weightVector !== undefined || weightRecency !== undefined || weightPath !== undefined
    const wv = weightVector ?? 0.7
    const wr = weightRecency ?? 0.2
    const wp = weightPath ?? 0.1
    const wTotal = wv + wr + wp || 1

    const poolSize = Math.max(topK * 5, 50)
    const dims = queryEmbedding.length

    let candidates: FileCandidate[] = []
    candidates.push(...await this.queryCandidates('file', queryEmbedding, dims, model, poolSize))
    if (searchChunks) candidates.push(...await this.queryCandidates('chunk', queryEmbedding, dims, model, poolSize))
    if (searchSymbols) candidates.push(...await this.queryCandidates('symbol', queryEmbedding, dims, model, poolSize))
    if (searchModules) candidates.push(...await this.queryCandidates('module', queryEmbedding, dims, model, poolSize))

    if (candidates.length === 0) return []

    const blobHashes = [...new Set(
      candidates.filter((c) => c.modulePath === undefined).map((c) => c.blobHash),
    )]

    if (branch) {
      const allowed = await this.getBranchSet(blobHashes, branch)
      candidates = candidates.filter((c) => c.modulePath !== undefined || allowed.has(c.blobHash))
      if (candidates.length === 0) return []
    }

    // before/after filtering by last-seen timestamp (mirrors PgVectorStore).
    if (before !== undefined || after !== undefined) {
      const lastSeen = await this.getLastSeenMap(blobHashes)
      const allowed = new Set(blobHashes.filter((h) => {
        const info = lastSeen.get(h)
        if (!info) return false
        if (before !== undefined && info.timestamp >= before) return false
        if (after !== undefined && info.timestamp <= after) return false
        return true
      }))
      candidates = candidates.filter((c) => c.modulePath !== undefined || allowed.has(c.blobHash))
      if (candidates.length === 0) return []
    }

    const needRecency = recent || useThreeSignal
    let recencyScores: Map<string, number> | null = null
    let firstSeenMap: Map<string, FirstSeenInfo> = new Map()
    if (needRecency) {
      const hashes = [...new Set(
        candidates.filter((c) => c.modulePath === undefined).map((c) => c.blobHash),
      )]
      firstSeenMap = await this.getFirstSeenMap(hashes)
      recencyScores = computeRecencyScores(firstSeenMap)
    }

    const fileHashes = [...new Set(
      candidates.filter((c) => c.modulePath === undefined).map((c) => c.blobHash),
    )]
    const pathsByBlob = await this.getPaths(fileHashes)

    const top = scoreAndDedupe(candidates, {
      query, topK, useThreeSignal, wv, wr, wp, wTotal, recent, alpha,
      recencyScores, pathsByBlob,
    })

    return top.map((c) => {
      if (c.modulePath !== undefined) {
        const base: SearchResult = { blobHash: '', kind: 'module', paths: [c.modulePath], score: c.score, modulePath: c.modulePath }
        if (explain) base.signals = { cosine: c.cosine }
        return base
      }
      const kind: SearchResultKind = c.symbolId !== undefined ? 'symbol' : c.chunkId !== undefined ? 'chunk' : 'file'
      const firstSeen = firstSeenMap.get(c.blobHash)
      const base: SearchResult = {
        blobHash: c.blobHash,
        kind,
        paths: pathsByBlob.get(c.blobHash) ?? [],
        score: c.score,
        firstCommit: firstSeen?.commitHash,
        firstSeen: firstSeen?.timestamp,
        chunkId: c.chunkId,
        startLine: c.startLine,
        endLine: c.endLine,
        symbolId: c.symbolId,
        symbolName: c.symbolName,
        symbolKind: c.symbolKind,
        language: c.language,
      }
      if (explain) {
        const recency = recencyScores?.get(c.blobHash)
        const blobPaths = pathsByBlob.get(c.blobHash) ?? []
        const pathScore = blobPaths.length > 0 ? Math.max(...blobPaths.map((p) => pathRelevanceScore(query, p))) : undefined
        base.signals = { cosine: c.cosine, recency: recency ?? undefined, pathScore }
      }
      return base
    })
  }

  async searchCommits(queryEmbedding: Embedding, options: CommitSearchOptions = {}): Promise<CommitSearchResult[]> {
    await verifyQdrantClient(this.client)
    const { topK = 10, model } = options
    const dims = queryEmbedding.length
    const candidates = await this.queryCandidates('commit', queryEmbedding, dims, model, topK)
    if (candidates.length === 0) return []

    const commitHashes = candidates.map((c) => c.blobHash)
    const { rows } = await this.pool.query<{ commit_hash: string; message: string; timestamp: string }>(
      'SELECT commit_hash, message, "timestamp" FROM commits WHERE commit_hash = ANY($1)',
      [commitHashes],
    )
    const byHash = new Map(rows.map((r) => [r.commit_hash, r]))

    const { rows: blobRows } = await this.pool.query<{ commit_hash: string; blob_hash: string }>(
      'SELECT commit_hash, blob_hash FROM blob_commits WHERE commit_hash = ANY($1)',
      [commitHashes],
    )
    const blobHashesByCommit = new Map<string, string[]>()
    for (const row of blobRows) {
      const list = blobHashesByCommit.get(row.commit_hash) ?? []
      list.push(row.blob_hash)
      blobHashesByCommit.set(row.commit_hash, list)
    }
    const allBlobHashes = [...new Set(blobRows.map((r) => r.blob_hash))]
    const pathsByBlob = await this.getPaths(allBlobHashes)

    return candidates
      .filter((c) => byHash.has(c.blobHash))
      .map((c) => {
        const row = byHash.get(c.blobHash)!
        const blobHashes = blobHashesByCommit.get(c.blobHash) ?? []
        const commitPaths = [...new Set(blobHashes.flatMap((h) => pathsByBlob.get(h) ?? []))]
        return {
          commitHash: c.blobHash,
          score: c.cosine,
          message: row.message,
          timestamp: Number(row.timestamp),
          paths: commitPaths,
        }
      })
  }

  async upsert(kind: VectorKind, items: VectorRecord[]): Promise<void> {
    if (items.length > 0) await verifyQdrantClient(this.client)
    for (const item of items) {
      const name = collectionName(kind, item.model, item.embedding.length)
      await this.ensureCollection(name, item.embedding.length)
      const vector = Array.from(item.embedding)

      switch (kind) {
        case 'file':
          await this.client.upsert(name, {
            wait: true,
            points: [{ id: toPointId(`file:${item.id}:${item.model}`), vector, payload: { blob_hash: item.id, model: item.model } }],
          })
          break
        case 'chunk':
          await this.client.upsert(name, {
            wait: true,
            points: [{
              id: toPointId(`chunk:${item.id}:${item.startLine ?? 0}:${item.endLine ?? 0}:${item.model}`),
              vector,
              payload: { blob_hash: item.id, model: item.model, start_line: item.startLine ?? 0, end_line: item.endLine ?? 0 },
            }],
          })
          break
        case 'symbol':
          await this.client.upsert(name, {
            wait: true,
            points: [{
              id: toPointId(`symbol:${item.id}:${item.startLine ?? 0}:${item.endLine ?? 0}:${item.symbolName ?? ''}:${item.model}`),
              vector,
              payload: {
                blob_hash: item.id, model: item.model,
                start_line: item.startLine ?? 0, end_line: item.endLine ?? 0,
                symbol_name: item.symbolName ?? '', symbol_kind: item.symbolKind ?? 'other', language: item.language ?? 'unknown',
              },
            }],
          })
          break
        case 'module':
          await this.client.upsert(name, {
            wait: true,
            points: [{
              id: toPointId(`module:${item.id}:${item.model}`),
              vector,
              payload: { module_path: item.id, model: item.model, blob_count: item.blobCount ?? 1 },
            }],
          })
          break
        case 'commit':
          await this.client.upsert(name, {
            wait: true,
            points: [{ id: toPointId(`commit:${item.id}:${item.model}`), vector, payload: { commit_hash: item.id, model: item.model } }],
          })
          break
      }
    }
  }

  async delete(kind: VectorKind, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await verifyQdrantClient(this.client)
    const names = await this.listCollections(kind)
    const payloadKey = kind === 'module' ? 'module_path' : kind === 'commit' ? 'commit_hash' : 'blob_hash'
    for (const name of names) {
      await this.client.delete(name, {
        wait: true,
        filter: { must: [{ key: payloadKey, match: { any: ids } }] },
      })
    }
  }

  /** Runs an ANN search across all collections for `kind` (and, if given, `model`/`dimensions`), merging results. */
  private async queryCandidates(
    kind: VectorKind, queryEmbedding: Embedding, dimensions: number, model: string | undefined, limit: number,
  ): Promise<FileCandidate[]> {
    const names = await this.listCollections(kind, model, dimensions)
    const vector = Array.from(queryEmbedding)
    const results: FileCandidate[] = []
    for (const name of names) {
      const hits = await this.client.search(name, { vector, limit, with_payload: true })
      for (const hit of hits) {
        const payload = (hit.payload ?? {}) as Record<string, unknown>
        if (kind === 'module') {
          results.push({ blobHash: '', cosine: hit.score, modulePath: String(payload.module_path) })
        } else if (kind === 'commit') {
          results.push({ blobHash: String(payload.commit_hash), cosine: hit.score })
        } else if (kind === 'chunk') {
          results.push({
            blobHash: String(payload.blob_hash), cosine: hit.score,
            chunkId: -1, startLine: Number(payload.start_line ?? 0), endLine: Number(payload.end_line ?? 0),
          })
        } else if (kind === 'symbol') {
          results.push({
            blobHash: String(payload.blob_hash), cosine: hit.score,
            symbolId: -1, startLine: Number(payload.start_line ?? 0), endLine: Number(payload.end_line ?? 0),
            symbolName: String(payload.symbol_name ?? ''), symbolKind: String(payload.symbol_kind ?? 'other'), language: String(payload.language ?? 'unknown'),
          })
        } else {
          results.push({ blobHash: String(payload.blob_hash), cosine: hit.score })
        }
      }
    }
    results.sort((a, b) => b.cosine - a.cosine)
    return results.slice(0, limit)
  }

  private async getBranchSet(blobHashes: string[], branch: string): Promise<Set<string>> {
    if (blobHashes.length === 0) return new Set()
    const { rows } = await this.pool.query<{ blob_hash: string }>(
      'SELECT blob_hash FROM blob_branches WHERE branch_name = $1 AND blob_hash = ANY($2)',
      [branch, blobHashes],
    )
    return new Set(rows.map((r) => r.blob_hash))
  }

  private async getFirstSeenMap(blobHashes: string[]): Promise<Map<string, FirstSeenInfo>> {
    const result = new Map<string, FirstSeenInfo>()
    if (blobHashes.length === 0) return result
    const { rows } = await this.pool.query<{ blob_hash: string; commit_hash: string; timestamp: string }>(
      `SELECT bc.blob_hash, c.commit_hash, c."timestamp"
       FROM blob_commits bc
       JOIN commits c ON c.commit_hash = bc.commit_hash
       WHERE bc.blob_hash = ANY($1)`,
      [blobHashes],
    )
    for (const row of rows) {
      const ts = Number(row.timestamp)
      const existing = result.get(row.blob_hash)
      if (!existing || ts < existing.timestamp) {
        result.set(row.blob_hash, { commitHash: row.commit_hash, timestamp: ts })
      }
    }
    return result
  }

  private async getLastSeenMap(blobHashes: string[]): Promise<Map<string, FirstSeenInfo>> {
    const result = new Map<string, FirstSeenInfo>()
    if (blobHashes.length === 0) return result
    const { rows } = await this.pool.query<{ blob_hash: string; commit_hash: string; timestamp: string }>(
      `SELECT bc.blob_hash, c.commit_hash, c."timestamp"
       FROM blob_commits bc
       JOIN commits c ON c.commit_hash = bc.commit_hash
       WHERE bc.blob_hash = ANY($1)`,
      [blobHashes],
    )
    for (const row of rows) {
      const ts = Number(row.timestamp)
      const existing = result.get(row.blob_hash)
      if (!existing || ts > existing.timestamp) {
        result.set(row.blob_hash, { commitHash: row.commit_hash, timestamp: ts })
      }
    }
    return result
  }

  private async getPaths(blobHashes: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    if (blobHashes.length === 0) return result
    const { rows } = await this.pool.query<{ blob_hash: string; path: string }>(
      'SELECT blob_hash, path FROM paths WHERE blob_hash = ANY($1)',
      [blobHashes],
    )
    for (const row of rows) {
      const list = result.get(row.blob_hash) ?? []
      list.push(row.path)
      result.set(row.blob_hash, list)
    }
    return result
  }
}
