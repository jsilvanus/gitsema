/**
 * pgvector-backed `VectorStore` (Phase 102).
 *
 * Fetches a wide candidate pool ordered by pgvector's `<=>` (cosine distance)
 * operator, then re-ranks it with the same JS three-signal logic
 * (`pathRelevanceScore`, `computeRecencyScores`) used by the SQLite adapter —
 * the trick already used by `--vss` to combine ANN candidates with gitsema's
 * ranking. Embedding columns are unconstrained `vector` (see migrations.ts),
 * so this performs an exact kNN scan rather than an HNSW-approximate one;
 * per-model HNSW indexes are a documented follow-up.
 *
 * Not yet supported on this backend (documented deviation, see PLAN.md):
 * `allowedHashes`, `useVss`, `earlyCut`, result caching (`noCache`/`queryText`).
 */

import type { Pool } from 'pg'
import { ensurePostgresSchema } from './migrations.js'
import { scoreAndDedupe, type RerankCandidate } from '../rerank.js'
import type { Embedding, SearchResult, SearchResultKind } from '../../models/types.js'
import { pathRelevanceScore, type VectorSearchOptions } from '../../search/analysis/vectorSearch.js'
import { computeRecencyScores, type FirstSeenInfo } from '../../search/temporal/timeSearch.js'
import type { CommitSearchOptions, CommitSearchResult } from '../../search/commitSearch.js'
import type { VectorKind, VectorRecord, VectorStore } from '../types.js'

/** Serializes an embedding to the pgvector text literal `[v1,v2,...]`. */
function toVectorLiteral(embedding: Embedding): string {
  return `[${Array.from(embedding).join(',')}]`
}

type FileCandidate = RerankCandidate

export class PgVectorStore implements VectorStore {
  constructor(private readonly pool: Pool) {}

  private async ready(): Promise<Pool> {
    await ensurePostgresSchema(this.pool)
    return this.pool
  }

  async countFileEmbeddings(model?: string): Promise<number> {
    const pool = await this.ready()
    const { rows } = model
      ? await pool.query<{ n: string }>('SELECT count(*) AS n FROM embeddings WHERE model = $1', [model])
      : await pool.query<{ n: string }>('SELECT count(*) AS n FROM embeddings')
    return Number(rows[0]?.n ?? 0)
  }

  async search(queryEmbedding: Embedding, options: VectorSearchOptions = {}): Promise<SearchResult[]> {
    // Fail loudly on options this backend cannot honor, rather than silently
    // returning unfiltered (wrong) results. `allowedHashes` is the candidate
    // filter behind boolean / negative-example search (review9 §4).
    if (options.allowedHashes && options.allowedHashes.size > 0) {
      throw new Error(
        'postgres vector backend does not support allowedHashes candidate filtering ' +
        '(used by boolean and negative-example search); run these queries on the sqlite backend',
      )
    }
    const pool = await this.ready()
    const {
      topK = 10, model, recent = false, alpha = 0.8, before, after,
      weightVector, weightRecency, weightPath, query = '',
      searchChunks = false, searchSymbols = false, searchModules = false, branch,
      negativeQueryEmbedding, negativeLambda, explain,
    } = options

    const useThreeSignal = weightVector !== undefined || weightRecency !== undefined || weightPath !== undefined
    const wv = weightVector ?? 0.7
    const wr = weightRecency ?? 0.2
    const wp = weightPath ?? 0.1
    const wTotal = wv + wr + wp || 1

    const poolSize = Math.max(topK * 5, 50)
    const queryVec = toVectorLiteral(queryEmbedding)
    const negVec = negativeQueryEmbedding ? toVectorLiteral(negativeQueryEmbedding) : undefined
    const negLambda = negativeLambda ?? 0.5

    let candidates: FileCandidate[] = []
    candidates.push(...await this.queryFileCandidates(pool, queryVec, negVec, model, branch, poolSize))
    if (searchChunks) candidates.push(...await this.queryChunkCandidates(pool, queryVec, model, branch, poolSize))
    if (searchSymbols) candidates.push(...await this.querySymbolCandidates(pool, queryVec, model, branch, poolSize))
    if (searchModules) candidates.push(...await this.queryModuleCandidates(pool, queryVec, model, poolSize))

    if (candidates.length === 0) return []

    const blobHashes = [...new Set(
      candidates.filter((c) => c.modulePath === undefined).map((c) => c.blobHash),
    )]

    // before/after filtering by last-seen timestamp (mirrors filterByTimeRangeLastSeen).
    if (before !== undefined || after !== undefined) {
      const lastSeen = await this.getLastSeenMap(pool, blobHashes)
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
      firstSeenMap = await this.getFirstSeenMap(pool, hashes)
      recencyScores = computeRecencyScores(firstSeenMap)
    }

    const fileHashes = [...new Set(
      candidates.filter((c) => c.modulePath === undefined).map((c) => c.blobHash),
    )]
    const pathsByBlob = await this.getPaths(pool, fileHashes)

    const top = scoreAndDedupe(candidates, {
      query, topK, useThreeSignal, wv, wr, wp, wTotal, recent, alpha,
      recencyScores, pathsByBlob,
      // negCosine is only populated when a negative query embedding was used.
      negLambda: negVec ? negLambda : undefined,
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
        qualifiedName: c.qualifiedName,
        signature: c.signature,
        signatureHash: c.signatureHash,
        parentQualifiedName: c.parentQualifiedName,
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
    const pool = await this.ready()
    const { topK = 10, model } = options
    const queryVec = toVectorLiteral(queryEmbedding)

    const params: unknown[] = [queryVec]
    let where = ''
    if (model) {
      params.push(model)
      where = `WHERE ce.model = $${params.length}`
    }
    params.push(topK)

    const { rows } = await pool.query<{ commit_hash: string; cosine: number; message: string; timestamp: string }>(
      `SELECT ce.commit_hash, 1 - (ce.vector <=> $1::vector) AS cosine, c.message, c."timestamp"
       FROM commit_embeddings ce
       JOIN commits c ON c.commit_hash = ce.commit_hash
       ${where}
       ORDER BY ce.vector <=> $1::vector
       LIMIT $${params.length}`,
      params,
    )
    if (rows.length === 0) return []

    const commitHashes = rows.map((r) => r.commit_hash)
    const { rows: blobRows } = await pool.query<{ commit_hash: string; blob_hash: string }>(
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
    const pathsByBlob = await this.getPaths(pool, allBlobHashes)

    return rows.map((r) => {
      const blobHashes = blobHashesByCommit.get(r.commit_hash) ?? []
      const commitPaths = [...new Set(blobHashes.flatMap((h) => pathsByBlob.get(h) ?? []))]
      return {
        commitHash: r.commit_hash,
        score: r.cosine,
        message: r.message,
        timestamp: Number(r.timestamp),
        paths: commitPaths,
      }
    })
  }

  async upsert(kind: VectorKind, items: VectorRecord[]): Promise<void> {
    const pool = await this.ready()
    for (const item of items) {
      const vec = toVectorLiteral(item.embedding)
      switch (kind) {
        case 'file':
          await pool.query(
            `INSERT INTO embeddings (blob_hash, model, dimensions, vector)
             VALUES ($1, $2, $3, $4::vector) ON CONFLICT (blob_hash, model) DO NOTHING`,
            [item.id, item.model, item.embedding.length, vec],
          )
          break
        case 'chunk': {
          const { rows } = await pool.query<{ id: number }>(
            `INSERT INTO chunks (blob_hash, start_line, end_line) VALUES ($1, $2, $3)
             ON CONFLICT (blob_hash, start_line, end_line) DO UPDATE SET blob_hash = EXCLUDED.blob_hash
             RETURNING id`,
            [item.id, item.startLine ?? 0, item.endLine ?? 0],
          )
          await pool.query(
            `INSERT INTO chunk_embeddings (chunk_id, model, dimensions, vector)
             VALUES ($1, $2, $3, $4::vector) ON CONFLICT (chunk_id, model) DO NOTHING`,
            [rows[0].id, item.model, item.embedding.length, vec],
          )
          break
        }
        case 'symbol': {
          const { rows } = await pool.query<{ id: number }>(
            `INSERT INTO symbols (blob_hash, start_line, end_line, symbol_name, symbol_kind, language,
                                  qualified_name, signature, signature_hash, parent_qualified_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (blob_hash, start_line, end_line, symbol_name) DO UPDATE SET
               symbol_kind = EXCLUDED.symbol_kind,
               qualified_name = EXCLUDED.qualified_name,
               signature = EXCLUDED.signature,
               signature_hash = EXCLUDED.signature_hash,
               parent_qualified_name = EXCLUDED.parent_qualified_name
             RETURNING id`,
            [
              item.id, item.startLine ?? 0, item.endLine ?? 0, item.symbolName ?? '', item.symbolKind ?? 'other', item.language ?? 'unknown',
              item.qualifiedName ?? null, item.signature ?? null, item.signatureHash ?? null, item.parentQualifiedName ?? null,
            ],
          )
          await pool.query(
            `INSERT INTO symbol_embeddings (symbol_id, model, dimensions, vector)
             VALUES ($1, $2, $3, $4::vector) ON CONFLICT (symbol_id, model) DO NOTHING`,
            [rows[0].id, item.model, item.embedding.length, vec],
          )
          break
        }
        case 'module':
          await pool.query(
            `INSERT INTO module_embeddings (module_path, model, dimensions, vector, blob_count, updated_at)
             VALUES ($1, $2, $3, $4::vector, $5, $6)
             ON CONFLICT (module_path, model) DO UPDATE SET
               dimensions = EXCLUDED.dimensions, vector = EXCLUDED.vector,
               blob_count = EXCLUDED.blob_count, updated_at = EXCLUDED.updated_at`,
            [item.id, item.model, item.embedding.length, vec, item.blobCount ?? 1, Date.now()],
          )
          break
        case 'commit':
          await pool.query(
            `INSERT INTO commit_embeddings (commit_hash, model, dimensions, vector)
             VALUES ($1, $2, $3, $4::vector) ON CONFLICT (commit_hash, model) DO NOTHING`,
            [item.id, item.model, item.embedding.length, vec],
          )
          break
      }
    }
  }

  async delete(kind: VectorKind, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const pool = await this.ready()
    switch (kind) {
      case 'file':
        await pool.query('DELETE FROM embeddings WHERE blob_hash = ANY($1)', [ids])
        break
      case 'chunk':
        await pool.query('DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE blob_hash = ANY($1))', [ids])
        await pool.query('DELETE FROM chunks WHERE blob_hash = ANY($1)', [ids])
        break
      case 'symbol':
        await pool.query('DELETE FROM symbol_embeddings WHERE symbol_id IN (SELECT id FROM symbols WHERE blob_hash = ANY($1))', [ids])
        await pool.query('DELETE FROM symbols WHERE blob_hash = ANY($1)', [ids])
        break
      case 'module':
        await pool.query('DELETE FROM module_embeddings WHERE module_path = ANY($1)', [ids])
        break
      case 'commit':
        await pool.query('DELETE FROM commit_embeddings WHERE commit_hash = ANY($1)', [ids])
        break
    }
  }

  private async queryFileCandidates(
    pool: Pool, queryVec: string, negVec: string | undefined, model: string | undefined, branch: string | undefined, limit: number,
  ): Promise<FileCandidate[]> {
    const params: unknown[] = [queryVec]
    const conds: string[] = []
    if (model) { params.push(model); conds.push(`e.model = $${params.length}`) }
    if (branch) { params.push(branch); conds.push(`e.blob_hash IN (SELECT blob_hash FROM blob_branches WHERE branch_name = $${params.length})`) }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
    let negSelect = ''
    if (negVec) { params.push(negVec); negSelect = `, 1 - (e.vector <=> $${params.length}::vector) AS neg_cosine` }
    params.push(limit)

    const { rows } = await pool.query<{ blob_hash: string; cosine: number; neg_cosine?: number }>(
      `SELECT e.blob_hash, 1 - (e.vector <=> $1::vector) AS cosine ${negSelect}
       FROM embeddings e
       ${where}
       ORDER BY e.vector <=> $1::vector
       LIMIT $${params.length}`,
      params,
    )
    return rows.map((r) => ({ blobHash: r.blob_hash, cosine: r.cosine, negCosine: r.neg_cosine }))
  }

  private async queryChunkCandidates(
    pool: Pool, queryVec: string, model: string | undefined, branch: string | undefined, limit: number,
  ): Promise<FileCandidate[]> {
    const params: unknown[] = [queryVec]
    const conds: string[] = []
    if (model) { params.push(model); conds.push(`ce.model = $${params.length}`) }
    if (branch) { params.push(branch); conds.push(`c.blob_hash IN (SELECT blob_hash FROM blob_branches WHERE branch_name = $${params.length})`) }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
    params.push(limit)

    const { rows } = await pool.query<{ blob_hash: string; start_line: number; end_line: number; cosine: number; chunk_id: number }>(
      `SELECT c.blob_hash, c.start_line, c.end_line, c.id AS chunk_id, 1 - (ce.vector <=> $1::vector) AS cosine
       FROM chunk_embeddings ce
       JOIN chunks c ON c.id = ce.chunk_id
       ${where}
       ORDER BY ce.vector <=> $1::vector
       LIMIT $${params.length}`,
      params,
    )
    return rows.map((r) => ({ blobHash: r.blob_hash, cosine: r.cosine, chunkId: r.chunk_id, startLine: r.start_line, endLine: r.end_line }))
  }

  private async querySymbolCandidates(
    pool: Pool, queryVec: string, model: string | undefined, branch: string | undefined, limit: number,
  ): Promise<FileCandidate[]> {
    const params: unknown[] = [queryVec]
    const conds: string[] = []
    if (model) { params.push(model); conds.push(`se.model = $${params.length}`) }
    if (branch) { params.push(branch); conds.push(`s.blob_hash IN (SELECT blob_hash FROM blob_branches WHERE branch_name = $${params.length})`) }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
    params.push(limit)

    const { rows } = await pool.query<{
      blob_hash: string; start_line: number; end_line: number; symbol_id: number
      symbol_name: string; symbol_kind: string; language: string; cosine: number
      qualified_name: string | null; signature: string | null
      signature_hash: string | null; parent_qualified_name: string | null
    }>(
      `SELECT s.blob_hash, s.start_line, s.end_line, s.id AS symbol_id, s.symbol_name, s.symbol_kind, s.language,
              s.qualified_name, s.signature, s.signature_hash, s.parent_qualified_name,
              1 - (se.vector <=> $1::vector) AS cosine
       FROM symbol_embeddings se
       JOIN symbols s ON s.id = se.symbol_id
       ${where}
       ORDER BY se.vector <=> $1::vector
       LIMIT $${params.length}`,
      params,
    )
    return rows.map((r) => ({
      blobHash: r.blob_hash, cosine: r.cosine, startLine: r.start_line, endLine: r.end_line,
      symbolId: r.symbol_id, symbolName: r.symbol_name, symbolKind: r.symbol_kind, language: r.language,
      qualifiedName: r.qualified_name ?? undefined, signature: r.signature ?? undefined,
      signatureHash: r.signature_hash ?? undefined, parentQualifiedName: r.parent_qualified_name ?? undefined,
    }))
  }

  private async queryModuleCandidates(
    pool: Pool, queryVec: string, model: string | undefined, limit: number,
  ): Promise<FileCandidate[]> {
    const params: unknown[] = [queryVec]
    const where = model ? (params.push(model), `WHERE me.model = $${params.length}`) : ''
    params.push(limit)

    const { rows } = await pool.query<{ module_path: string; cosine: number }>(
      `SELECT me.module_path, 1 - (me.vector <=> $1::vector) AS cosine
       FROM module_embeddings me
       ${where}
       ORDER BY me.vector <=> $1::vector
       LIMIT $${params.length}`,
      params,
    )
    return rows.map((r) => ({ blobHash: '', cosine: r.cosine, modulePath: r.module_path }))
  }

  private async getFirstSeenMap(pool: Pool, blobHashes: string[]): Promise<Map<string, FirstSeenInfo>> {
    const result = new Map<string, FirstSeenInfo>()
    if (blobHashes.length === 0) return result
    const { rows } = await pool.query<{ blob_hash: string; commit_hash: string; timestamp: string }>(
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

  private async getLastSeenMap(pool: Pool, blobHashes: string[]): Promise<Map<string, FirstSeenInfo>> {
    const result = new Map<string, FirstSeenInfo>()
    if (blobHashes.length === 0) return result
    const { rows } = await pool.query<{ blob_hash: string; commit_hash: string; timestamp: string }>(
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

  private async getPaths(pool: Pool, blobHashes: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    if (blobHashes.length === 0) return result
    const { rows } = await pool.query<{ blob_hash: string; path: string }>(
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
