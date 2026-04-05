import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths, chunks, chunkEmbeddings, symbols, symbolEmbeddings, moduleEmbeddings } from '../db/schema.js'
import { inArray, eq, sql, and, type SQL } from 'drizzle-orm'
import type { Embedding, SearchResult } from '../models/types.js'
import { filterByTimeRange, getFirstSeenMap, computeRecencyScores } from './timeSearch.js'
import { dequantizeVector, deserializeQuantized } from '../embedding/quantize.js'

/**
 * Computes the cosine similarity between two vectors.
 * Returns a value in [-1, 1]; 1 means identical direction.
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Computes the L2 norm (magnitude) of an embedding vector.
 * Use with cosineSimilarityPrecomputed to avoid recomputing the query norm in a tight loop.
 */
export function vectorNorm(v: Embedding): number {
  let sq = 0
  for (let i = 0; i < v.length; i++) sq += v[i] * v[i]
  return Math.sqrt(sq)
}

/**
 * Cosine similarity where the L2 norm of `a` has been pre-computed.
 * Use in hot loops where `a` is the same query embedding and `b` changes each iteration.
 */
export function cosineSimilarityPrecomputed(a: Embedding, aMag: number, b: Embedding): number {
  let dot = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magB += b[i] * b[i]
  }
  const denom = aMag * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Deserializes a Float32Array stored as a Buffer back to number[].
 */
function bufferToEmbedding(buf: Buffer): Float32Array {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return f32
}

type CandidateRow = {
  blobHash: string; vector: Buffer
  quantized?: number | null; quantMin?: number | null; quantScale?: number | null
  chunkId?: number; startLine?: number; endLine?: number
  symbolId?: number; symbolName?: string; symbolKind?: string; language?: string
  /** Set for module-level results — the directory path. */
  modulePath?: string
}

function rowToEmbedding(row: CandidateRow): Float32Array {
  if (row.quantized === 1 && row.quantMin != null && row.quantScale != null) {
    const q = deserializeQuantized(row.vector, row.quantMin, row.quantScale)
    return dequantizeVector(q)
  }
  return bufferToEmbedding(row.vector)
}

/**
 * Computes a path relevance score in [0, 1] by counting how many
 * lowercase query tokens appear as substrings in the file path.
 */
export function pathRelevanceScore(query: string, filePath: string): number {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean)
  if (tokens.length === 0) return 0
  const lower = filePath.toLowerCase()
  const matches = tokens.filter((t) => lower.includes(t)).length
  return matches / tokens.length
}

export interface VectorSearchOptions {
  topK?: number
  /** When set, only embeddings produced by this model are considered. */
  model?: string
  /** When true, blends cosine similarity with a recency score. */
  recent?: boolean
  /** Weight for cosine similarity in the blended score (default 0.8). Only used with `recent`. */
  alpha?: number
  /** Only include blobs whose earliest commit is strictly before this Unix timestamp (seconds). */
  before?: number
  /** Only include blobs whose earliest commit is strictly after this Unix timestamp (seconds). */
  after?: number
  /**
   * Three-signal ranking weights (Phase 10).
   * When any of these is provided, the three-signal formula is used instead of
   * the simple cosine (or cosine+recency) formula.
   * Weights need not sum to 1; they are normalised internally.
   */
  weightVector?: number
  weightRecency?: number
  weightPath?: number
  /** The original query string, used to compute path relevance scores. */
  query?: string
  /** When true, search chunk embeddings in addition to whole-file embeddings. */
  searchChunks?: boolean
  /** When true, search symbol-level embeddings (named function/class declarations). */
  searchSymbols?: boolean
  /** When true, search module-level (directory centroid) embeddings. */
  searchModules?: boolean
  /** When set, restrict results to blobs that appear on this branch (short name, e.g. "main"). */
  branch?: string
}

/**
 * Searches the database by embedding all stored vectors against the query
 * vector, then returns the top-k results sorted by cosine similarity (or
 * blended score when `recent` is true). Supports temporal filtering via
 * `before` / `after` Unix timestamps and three-signal ranking.
 */
export function vectorSearch(queryEmbedding: Embedding, options: VectorSearchOptions = {}): SearchResult[] {
  const {
    topK = 10, model, recent = false, alpha = 0.8, before, after,
    weightVector, weightRecency, weightPath, query = '',
    searchChunks = false, searchSymbols = false, searchModules = false, branch,
  } = options

  // Determine if three-signal ranking is active
  const useThreeSignal = weightVector !== undefined || weightRecency !== undefined || weightPath !== undefined
  const wv = weightVector ?? 0.7
  const wr = weightRecency ?? 0.2
  const wp = weightPath ?? 0.1
  const wTotal = wv + wr + wp || 1

  const { db, rawDb } = getActiveSession()

  // Load stored embeddings, optionally filtered to a specific model
  const baseQuery = db.select({
    blobHash: embeddings.blobHash,
    vector: embeddings.vector,
    quantized: embeddings.quantized,
    quantMin: embeddings.quantMin,
    quantScale: embeddings.quantScale,
  }).from(embeddings)

  // Build SQL-level filters for model and branch to avoid loading all rows
  const conditions: SQL[] = []
  if (model) conditions.push(eq(embeddings.model, model))
  if (branch) conditions.push(sql`${embeddings.blobHash} IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ${branch})`)
  const filteredQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery
  const allRows = filteredQuery.all()

  // Optionally include chunk embeddings
  let candidatePool: CandidateRow[] = allRows.map((r) => ({
    blobHash: r.blobHash,
    vector: r.vector as Buffer,
    quantized: r.quantized ?? null,
    quantMin: r.quantMin ?? null,
    quantScale: r.quantScale ?? null,
  }))

  if (searchChunks) {
    const chunkQuery = db.select({
      chunkId: chunks.id,
      blobHash: chunks.blobHash,
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      vector: chunkEmbeddings.vector,
      quantized: chunkEmbeddings.quantized,
      quantMin: chunkEmbeddings.quantMin,
      quantScale: chunkEmbeddings.quantScale,
    })
      .from(chunkEmbeddings)
      .innerJoin(chunks, eq(chunkEmbeddings.chunkId, chunks.id))

    const chunkConditions: SQL[] = []
    if (model) chunkConditions.push(eq(chunkEmbeddings.model, model))
    if (branch) chunkConditions.push(sql`${chunks.blobHash} IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ${branch})`)
    const chunkRows = chunkConditions.length > 0 ? chunkQuery.where(and(...chunkConditions)).all() : chunkQuery.all()

    for (const row of chunkRows) {
      candidatePool.push({
        blobHash: row.blobHash,
        vector: row.vector as Buffer,
        quantized: row.quantized ?? null,
        quantMin: row.quantMin ?? null,
        quantScale: row.quantScale ?? null,
        chunkId: row.chunkId,
        startLine: row.startLine,
        endLine: row.endLine,
      })
    }
  }

  if (searchSymbols) {

    const symQuery = db.select({
      symbolId: symbols.id,
      blobHash: symbols.blobHash,
      startLine: symbols.startLine,
      endLine: symbols.endLine,
      symbolName: symbols.symbolName,
      symbolKind: symbols.symbolKind,
      language: symbols.language,
      vector: symbolEmbeddings.vector,
      quantized: symbolEmbeddings.quantized,
      quantMin: symbolEmbeddings.quantMin,
      quantScale: symbolEmbeddings.quantScale,
    })
      .from(symbolEmbeddings)
      .innerJoin(symbols, eq(symbolEmbeddings.symbolId, symbols.id))

    const symConditions: SQL[] = []
    if (model) symConditions.push(eq(symbolEmbeddings.model, model))
    if (branch) symConditions.push(sql`${symbols.blobHash} IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ${branch})`)
    const symRows = symConditions.length > 0 ? symQuery.where(and(...symConditions)).all() : symQuery.all()

    for (const row of symRows) {
      candidatePool.push({
        blobHash: row.blobHash,
        vector: row.vector as Buffer,
        quantized: row.quantized ?? null,
        quantMin: row.quantMin ?? null,
        quantScale: row.quantScale ?? null,
        startLine: row.startLine,
        endLine: row.endLine,
        symbolId: row.symbolId,
        symbolName: row.symbolName,
        symbolKind: row.symbolKind,
        language: row.language,
      })
    }
  }

  if (searchModules) {
    const modQuery = db.select({
      id: moduleEmbeddings.id,
      modulePath: moduleEmbeddings.modulePath,
      vector: moduleEmbeddings.vector,
    }).from(moduleEmbeddings)

    const modRows = (model
      ? modQuery.where(eq(moduleEmbeddings.model, model))
      : modQuery).all()

    for (const row of modRows) {
      candidatePool.push({
        blobHash: `module:${row.modulePath}`,
        vector: row.vector as Buffer,
        modulePath: row.modulePath,
      })
    }
  }

  // Apply time-range filter on the candidate set before scoring
  const allHashes = [...new Set(candidatePool.map((r) => r.blobHash))]
  const filteredHashes = (before !== undefined || after !== undefined)
    ? new Set(filterByTimeRange(allHashes, before, after))
    : null   // null means no filter — include all

  const filteredPool = filteredHashes
    ? candidatePool.filter((r) => filteredHashes.has(r.blobHash))
    : candidatePool

  if (filteredPool.length === 0) return []

  // Pre-compute query norm once (H8 optimization — avoids recomputing it for every candidate)
  const queryNorm = vectorNorm(queryEmbedding)

  // Compute cosine similarity for each candidate
  type ScoredEntry = CandidateRow & { cosine: number }
  const scored: ScoredEntry[] = filteredPool.map((row) => ({
    ...row,
    cosine: cosineSimilarityPrecomputed(queryEmbedding, queryNorm, rowToEmbedding(row)),
  }))

  // Compute recency scores when needed
  const needRecency = recent || useThreeSignal
  let recencyScores: Map<string, number> | null = null
  if (needRecency) {
    const candidateHashes = [...new Set(scored.map((s) => s.blobHash))]
    const firstSeenMap = getFirstSeenMap(candidateHashes)
    recencyScores = computeRecencyScores(firstSeenMap)
  }

  // Resolve paths for path-relevance scoring (only when using three-signal ranking)
  let pathsByBlob: Map<string, string[]> | null = null
  if (useThreeSignal) {
    const hashes = [...new Set(scored.map((s) => s.blobHash))]
    const pathRows = db.select({ blobHash: paths.blobHash, path: paths.path })
      .from(paths)
      .where(inArray(paths.blobHash, hashes))
      .all()
    pathsByBlob = new Map()
    for (const row of pathRows) {
      const list = pathsByBlob.get(row.blobHash) ?? []
      list.push(row.path)
      pathsByBlob.set(row.blobHash, list)
    }
  }

  // Apply ranking formula
  type FinalEntry = ScoredEntry & { score: number }
  const finalScored: FinalEntry[] = scored.map((s) => {
    let score: number

    if (useThreeSignal) {
      const recency = recencyScores?.get(s.blobHash) ?? 0
      const blobPaths = pathsByBlob?.get(s.blobHash) ?? []
      const pathScore = blobPaths.length > 0
        ? Math.max(...blobPaths.map((p) => pathRelevanceScore(query, p)))
        : 0
      score = (wv * s.cosine + wr * recency + wp * pathScore) / wTotal
    } else if (recent) {
      const recency = recencyScores?.get(s.blobHash) ?? 0
      score = alpha * s.cosine + (1 - alpha) * recency
    } else {
      score = s.cosine
    }

    return { ...s, score }
  })

  // Sort descending by score, deduplicate by blobHash (keep highest-scoring entry
  // per blob), then take top-k. This prevents the same file appearing multiple
  // times when chunk embeddings are included.
  finalScored.sort((a, b) => b.score - a.score)
  const bestByBlob = new Map<string, FinalEntry>()
  for (const entry of finalScored) {
    const existing = bestByBlob.get(entry.blobHash)
    if (!existing || entry.score > existing.score) {
      bestByBlob.set(entry.blobHash, entry)
    }
  }
  const topEntries = Array.from(bestByBlob.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  if (topEntries.length === 0) return []

  // Resolve file paths for the result set (reuse if already loaded)
  const blobHashes = [...new Set(topEntries.map((b) => b.blobHash))]
  if (!pathsByBlob) {
    const pathRows = db.select({
      blobHash: paths.blobHash,
      path: paths.path,
    }).from(paths).where(inArray(paths.blobHash, blobHashes)).all()

    pathsByBlob = new Map()
    for (const row of pathRows) {
      const list = pathsByBlob.get(row.blobHash) ?? []
      list.push(row.path)
      pathsByBlob.set(row.blobHash, list)
    }
  }

  // Resolve firstCommit / firstSeen for the result set
  const firstSeenMap = getFirstSeenMap(blobHashes)

  return topEntries.map((b) => {
    const firstSeen = firstSeenMap.get(b.blobHash)
    // Module results use a synthetic blobHash `module:<path>` and do not have
    // entries in the paths table. Map them to modulePath and expose a single
    // path equal to the modulePath for display purposes.
    if (b.modulePath !== undefined) {
      return {
        blobHash: b.blobHash,
        paths: [b.modulePath],
        score: b.score,
        modulePath: b.modulePath,
      }
    }

    return {
      blobHash: b.blobHash,
      paths: pathsByBlob!.get(b.blobHash) ?? [],
      score: b.score,
      firstCommit: firstSeen?.commitHash,
      firstSeen: firstSeen?.timestamp,
      chunkId: b.chunkId,
      startLine: b.startLine,
      endLine: b.endLine,
      symbolId: b.symbolId,
      symbolName: b.symbolName,
      symbolKind: b.symbolKind,
      language: b.language,
    }
  })
}

/**
 * Merges two ranked result lists (from different models) into a single list.
 * When a blob appears in both, the higher score is kept. The final list is
 * re-sorted by score descending and truncated to topK.
 */
export function mergeSearchResults(
  a: SearchResult[],
  b: SearchResult[],
  topK: number,
): SearchResult[] {
  const best = new Map<string, SearchResult>()
  for (const r of [...a, ...b]) {
    const existing = best.get(r.blobHash)
    if (!existing || r.score > existing.score) {
      best.set(r.blobHash, r)
    }
  }
  return Array.from(best.values())
    .sort((x, y) => y.score - x.score)
    .slice(0, topK)
}

/**
 * Returns the set of blob hashes that appear on a specific branch,
 * according to the `blob_branches` table.  Returns an empty set when the
 * branch has no indexed blobs or the table is empty.
 */
export function getBranchBlobHashSet(branch: string): Set<string> {
  const { rawDb } = getActiveSession()
  const rows = rawDb
    .prepare('SELECT DISTINCT blob_hash FROM blob_branches WHERE branch_name = ?')
    .all(branch) as Array<{ blob_hash: string }>
  return new Set(rows.map((r) => r.blob_hash))
}
