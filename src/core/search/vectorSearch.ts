import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths, chunks, chunkEmbeddings, symbols, symbolEmbeddings, moduleEmbeddings } from '../db/schema.js'
import { inArray, eq, sql, and, type SQL } from 'drizzle-orm'
import type { Embedding, SearchResult } from '../models/types.js'
import { filterByTimeRange, getFirstSeenMap, computeRecencyScores } from './timeSearch.js'
import { dequantizeVector, deserializeQuantized } from '../embedding/quantize.js'
import { getCachedResults, setCachedResults, buildCacheKey, embeddingFingerprint } from './resultCache.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// HNSW / ANN search support
// ---------------------------------------------------------------------------

/**
 * Threshold (blob count) above which ANN search is automatically preferred
 * when a usearch index is available.  Override via GITSEMA_VSS_THRESHOLD.
 */
const DEFAULT_VSS_THRESHOLD = 50_000

function getVssThreshold(): number {
  const raw = process.env.GITSEMA_VSS_THRESHOLD
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return DEFAULT_VSS_THRESHOLD
}

const DB_DIR = '.gitsema'

/** Cached usearch module so we only dynamic-import once. */
let _usearchModule: typeof import('usearch') | null | undefined = undefined

async function loadUsearch(): Promise<typeof import('usearch') | null> {
  if (_usearchModule !== undefined) return _usearchModule
  try {
    _usearchModule = await import('usearch')
  } catch {
    _usearchModule = null
  }
  return _usearchModule
}

/**
 * Resolves the paths to the usearch index file and blob-hash map for a model.
 * Returns null when no index exists on disk.
 */
export function getVssIndexPaths(model: string): { indexPath: string; mapPath: string } | null {
  const safeName = model.replace(/[^a-zA-Z0-9._-]/g, '_')
  const indexPath = join(DB_DIR, `vectors-${safeName}.usearch`)
  const mapPath = join(DB_DIR, `vectors-${safeName}.map.json`)
  if (existsSync(indexPath) && existsSync(mapPath)) {
    return { indexPath, mapPath }
  }
  return null
}

/**
 * Attempts an ANN search via usearch HNSW index.
 * Returns the top-k blob hashes (approximate nearest neighbours) sorted by
 * similarity (best first), or null when the index cannot be used.
 *
 * The caller is responsible for falling back to exact search on null.
 */
export async function annSearch(
  queryEmbedding: Embedding,
  model: string,
  topK: number,
): Promise<string[] | null> {
  const paths = getVssIndexPaths(model)
  if (!paths) return null

  const usearch = await loadUsearch()
  if (!usearch) return null

  try {
    const Index = (usearch as any).Index ?? (usearch as any).default?.Index
    if (!Index) return null

    const idToHash: string[] = JSON.parse(readFileSync(paths.mapPath, 'utf8'))
    const index = new Index({ metric: 'cos' })
    index.load(paths.indexPath)

    const vec = queryEmbedding instanceof Float32Array
      ? queryEmbedding
      : new Float32Array(queryEmbedding as number[])

    // Request more candidates than topK to account for filters applied later
    const searchK = Math.min(Math.max(topK * 4, 50), idToHash.length)
    const { keys } = index.search(vec, searchK)
    const hashes: string[] = []
    for (let i = 0; i < keys.length; i++) {
      const id = typeof keys[i] === 'bigint' ? Number(keys[i]) : keys[i]
      if (id >= 0 && id < idToHash.length) hashes.push(idToHash[id])
    }
    return hashes
  } catch {
    return null
  }
}

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
  /** Negative example embedding to subtract from score (P3-2). */
  negativeQueryEmbedding?: Embedding
  /** Weight for negative example subtraction (default 0.5) */
  negativeLambda?: number
  /** When true, populate `signals` on returned SearchResult objects with per-signal values. */
  explain?: boolean
  /**
   * When set, limit the candidate pool to this many randomly-sampled rows before scoring.
   * Useful for very large indexes (>100K blobs) where full cosine scan is expensive.
   * Set to 0 or omit to disable (default: full scan).
   */
  earlyCut?: number
  /**
   * When true, route through the HNSW/usearch ANN index when available.
   * Also triggered automatically when the blob count exceeds GITSEMA_VSS_THRESHOLD (default 50K).
   * Falls back to exact cosine scan when no index exists or usearch is not installed.
   */
  useVss?: boolean
  /**
   * The original query text (used as cache key component).
   * When omitted, a fingerprint of the embedding is used instead.
   */
  queryText?: string
  /**
   * When true, bypass the result cache.
   * Useful for tests and when fresh results are always required.
   */
  noCache?: boolean
  /**
   * When set, restrict the candidate pool to only these blob hashes.
   * Used internally by ANN/HNSW pre-filtering to speed up exact scoring.
   */
  allowedHashes?: Set<string>
}

/**
 * Searches the database by embedding all stored vectors against the query
 * vector, then returns the top-k results sorted by cosine similarity (or
 * blended score when `recent` is true). Supports temporal filtering via
 * `before` / `after` Unix timestamps and three-signal ranking.
 *
 * Results are cached in memory (default TTL 60 s) keyed by query text/embedding
 * fingerprint + options. Use `noCache: true` to bypass.
 */
export function vectorSearch(queryEmbedding: Embedding, options: VectorSearchOptions = {}): SearchResult[] {
  const {
    topK = 10, model, recent = false, alpha = 0.8, before, after,
    weightVector, weightRecency, weightPath, query = '',
    searchChunks = false, searchSymbols = false, searchModules = false, branch,
    negativeQueryEmbedding, negativeLambda, explain, earlyCut = 0,
    queryText, noCache = false, allowedHashes,
  } = options

  // ── Result cache lookup ───────────────────────────────────────────────────
  // Cache key excludes `noCache` and `allowedHashes` (internal optimisation flag)
  // so callers get consistent results regardless of whether ANN pre-filtered.
  const cacheKeyOptions: Record<string, unknown> = {
    topK, model, recent, alpha, before, after,
    weightVector, weightRecency, weightPath, query,
    searchChunks, searchSymbols, searchModules, branch,
    negativeLambda, explain, earlyCut,
  }
  const cacheKey = buildCacheKey(
    queryText ?? embeddingFingerprint(queryEmbedding),
    cacheKeyOptions,
  )
  if (!noCache) {
    const cached = getCachedResults(cacheKey)
    if (cached) return cached
  }

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

  // Apply ANN pre-filter: when `allowedHashes` is provided (set by vectorSearchWithAnn),
  // restrict the candidate pool to those hashes before loading chunk/symbol embeddings.
  if (allowedHashes) {
    candidatePool = candidatePool.filter((r) => allowedHashes.has(r.blobHash))
  }

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

  // ── Early-cut: reservoir sampling when pool is very large ─────────────────
  // When earlyCut > 0 and the pool exceeds that size, use reservoir sampling
  // (Knuth Algorithm R) to pick `earlyCut` items without cloning the full pool.
  // Memory cost is O(earlyCut), not O(pool).
  const scoringPool = (earlyCut > 0 && filteredPool.length > earlyCut)
    ? reservoirSample(filteredPool, earlyCut)
    : filteredPool

  // Pre-compute query norm once (H8 optimization — avoids recomputing it for every candidate)
  const queryNorm = vectorNorm(queryEmbedding)
  const negEmbedding = options.negativeQueryEmbedding ?? null
  const negLambda = options.negativeLambda ?? 0.5
  const negNorm = negEmbedding ? vectorNorm(negEmbedding) : 0

  // Compute recency scores when needed (use scoringPool)
  const needRecency = recent || useThreeSignal
  let recencyScores: Map<string, number> | null = null
  if (needRecency) {
    const candidateHashes = [...new Set(scoringPool.map((r) => r.blobHash))]
    const firstSeenMap = getFirstSeenMap(candidateHashes)
    recencyScores = computeRecencyScores(firstSeenMap)
  }

  // Resolve paths for path-relevance scoring (only when using three-signal ranking)
  let pathsByBlob: Map<string, string[]> | null = null
  if (useThreeSignal) {
    const hashes = [...new Set(scoringPool.map((r) => r.blobHash))]
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

  // Single-pass scoring: compute cosine (and negative cosine if present) and final score per candidate
  type FinalEntry = CandidateRow & { cosine: number; score: number }
  /** Build a FinalEntry by copying all fields from row plus cosine/score. */
  function makeFinalEntry(row: CandidateRow, cosine: number, score: number): FinalEntry {
    return {
      blobHash: row.blobHash, vector: row.vector,
      quantized: row.quantized, quantMin: row.quantMin, quantScale: row.quantScale,
      chunkId: row.chunkId, startLine: row.startLine, endLine: row.endLine,
      symbolId: row.symbolId, symbolName: row.symbolName, symbolKind: row.symbolKind,
      language: row.language, modulePath: row.modulePath,
      cosine, score,
    }
  }
  const finalScored: FinalEntry[] = []
  for (const row of scoringPool) {
    const emb = rowToEmbedding(row)
    const cosine = cosineSimilarityPrecomputed(queryEmbedding, queryNorm, emb)
    let score = cosine
    let negCos = 0
    if (negEmbedding) {
      negCos = cosineSimilarityPrecomputed(negEmbedding, negNorm, emb)
      score = cosine - (negLambda * negCos)
    }

    // Blend with recency/path signals if requested
    if (useThreeSignal) {
      const recency = recencyScores?.get(row.blobHash) ?? 0
      const blobPaths = pathsByBlob?.get(row.blobHash) ?? []
      const pathScore = blobPaths.length > 0 ? Math.max(...blobPaths.map((p) => pathRelevanceScore(query, p))) : 0
      score = (wv * cosine + wr * recency + wp * pathScore) / wTotal
    } else if (recent) {
      const recency = recencyScores?.get(row.blobHash) ?? 0
      score = alpha * cosine + (1 - alpha) * recency
    }
    finalScored.push(makeFinalEntry(row, cosine, score))
  }

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

  const results = topEntries.map((b) => {
    const firstSeen = firstSeenMap.get(b.blobHash)
    // Module results use a synthetic blobHash `module:<path>` and do not have
    // entries in the paths table. Map them to modulePath and expose a single
    // path equal to the modulePath for display purposes.
    if (b.modulePath !== undefined) {
      const base: any = {
        kind: 'module',
        blobHash: b.blobHash,
        paths: [b.modulePath],
        score: b.score,
        modulePath: b.modulePath,
      }
      if (options.explain) {
        base.signals = { cosine: b.cosine }
      }
      return base
    }

    // Determine kind from available fields
    let kind: 'file' | 'chunk' | 'symbol' = 'file'
    if (b.symbolId !== undefined) kind = 'symbol'
    else if (b.chunkId !== undefined) kind = 'chunk'

    const base: any = {
      kind,
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

    if (options.explain) {
      const recency = recencyScores?.get(b.blobHash)
      const blobPaths = pathsByBlob?.get(b.blobHash) ?? []
      const pathScore = blobPaths.length > 0 ? Math.max(...blobPaths.map((p) => pathRelevanceScore(query, p))) : undefined
      base.signals = { cosine: b.cosine, recency: recency ?? undefined, pathScore }
    }

    return base
  })

  // Store in cache (skip when noCache or when ANN pre-filter was applied — the
  // ANN wrapper handles caching for that path)
  if (!noCache && !allowedHashes) {
    setCachedResults(cacheKey, results)
  }

  return results
}

/**
 * Async variant of vectorSearch that first runs an ANN query via the usearch
 * HNSW index (when available) to pre-filter the candidate pool, then runs
 * exact cosine scoring on the smaller candidate set.
 *
 * Decision logic:
 *   - If `options.useVss` is explicitly true → attempt ANN
 *   - If the embedding count exceeds GITSEMA_VSS_THRESHOLD (default 50K) → attempt ANN
 *   - On any failure (no index, usearch not installed, usearch error) → exact search
 *
 * Results are stored in the result cache (same key as sync vectorSearch).
 */
export async function vectorSearchWithAnn(
  queryEmbedding: Embedding,
  options: VectorSearchOptions = {},
): Promise<SearchResult[]> {
  const { topK = 10, model, useVss, queryText, noCache = false } = options

  // Cache check (same logic as vectorSearch)
  const cacheKeyOptions: Record<string, unknown> = {
    topK, model,
    recent: options.recent, alpha: options.alpha,
    before: options.before, after: options.after,
    weightVector: options.weightVector, weightRecency: options.weightRecency, weightPath: options.weightPath,
    query: options.query, searchChunks: options.searchChunks, searchSymbols: options.searchSymbols,
    searchModules: options.searchModules, branch: options.branch,
    negativeLambda: options.negativeLambda, explain: options.explain, earlyCut: options.earlyCut,
  }
  const cacheKey = buildCacheKey(
    queryText ?? embeddingFingerprint(queryEmbedding),
    cacheKeyOptions,
  )
  if (!noCache) {
    const cached = getCachedResults(cacheKey)
    if (cached) return cached
  }

  // Decide whether to attempt ANN
  const resolvedModel = model ?? (process.env.GITSEMA_MODEL ?? 'nomic-embed-text')
  let shouldUseAnn = useVss === true

  if (!shouldUseAnn) {
    // Auto-trigger when index is large enough
    try {
      const { rawDb } = getActiveSession()
      const countRow = rawDb.prepare('SELECT COUNT(*) AS n FROM embeddings').get() as { n: number }
      if (countRow && countRow.n >= getVssThreshold()) shouldUseAnn = true
    } catch {
      // Ignore errors — fall through to exact search
    }
  }

  let allowedHashes: Set<string> | undefined
  if (shouldUseAnn) {
    const annHashes = await annSearch(queryEmbedding, resolvedModel, topK)
    if (annHashes && annHashes.length > 0) {
      allowedHashes = new Set(annHashes)
    }
  }

  const results = vectorSearch(queryEmbedding, { ...options, allowedHashes, noCache: true })

  if (!noCache) {
    setCachedResults(cacheKey, results)
  }

  return results
}

/**
 * Reservoir sampling (Knuth Algorithm R): selects `k` items from `pool`
 * without cloning the full array.  Memory cost is O(k).
 *
 * Exported for unit testing.
 */
export function reservoirSample<T>(pool: T[], k: number): T[] {
  if (k >= pool.length) return pool
  const reservoir = pool.slice(0, k)
  for (let i = k; i < pool.length; i++) {
    const j = Math.floor(Math.random() * (i + 1))
    if (j < k) reservoir[j] = pool[i]
  }
  return reservoir
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
  for (const r of a) {
    const existing = best.get(r.blobHash)
    if (!existing || r.score > existing.score) best.set(r.blobHash, r)
  }
  for (const r of b) {
    const existing = best.get(r.blobHash)
    if (!existing || r.score > existing.score) best.set(r.blobHash, r)
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
