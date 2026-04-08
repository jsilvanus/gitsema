import { getActiveSession } from '../../db/sqlite.js'
import Database from 'better-sqlite3'
import { embeddings, paths, chunks, chunkEmbeddings, symbols, symbolEmbeddings, moduleEmbeddings } from '../../db/schema.js'
import { inArray, eq, sql, and, type SQL } from 'drizzle-orm'
import type { Embedding, SearchResult, SearchResultKind } from '../../models/types.js'
import { filterByTimeRange, getFirstSeenMap, computeRecencyScores } from '../temporal/timeSearch.js'
import { dequantizeVector, deserializeQuantized } from '../../embedding/quantize.js'
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

export function vectorNorm(v: Embedding): number {
  let sq = 0
  for (let i = 0; i < v.length; i++) sq += v[i] * v[i]
  return Math.sqrt(sq)
}

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

function bufferToEmbedding(buf: Buffer): Float32Array {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return f32
}

type CandidateRow = {
  blobHash: string; vector: Buffer
  quantized?: number | null; quantMin?: number | null; quantScale?: number | null
  chunkId?: number; startLine?: number; endLine?: number
  symbolId?: number; symbolName?: string; symbolKind?: string; language?: string
  modulePath?: string
}

function rowToEmbedding(row: CandidateRow): Float32Array {
  if (row.quantized === 1 && row.quantMin != null && row.quantScale != null) {
    const q = deserializeQuantized(row.vector, row.quantMin, row.quantScale)
    return dequantizeVector(q)
  }
  return bufferToEmbedding(row.vector)
}

export function pathRelevanceScore(query: string, filePath: string): number {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean)
  if (tokens.length === 0) return 0
  const lower = filePath.toLowerCase()
  const matches = tokens.filter((t) => lower.includes(t)).length
  return matches / tokens.length
}

export interface VectorSearchOptions {
  topK?: number
  model?: string
  recent?: boolean
  alpha?: number
  before?: number
  after?: number
  weightVector?: number
  weightRecency?: number
  weightPath?: number
  query?: string
  searchChunks?: boolean
  searchSymbols?: boolean
  searchModules?: boolean
  branch?: string
  negativeQueryEmbedding?: Embedding
  negativeLambda?: number
  explain?: boolean
  earlyCut?: number
  useVss?: boolean
  queryText?: string
  noCache?: boolean
  allowedHashes?: Set<string>
}

export function vectorSearch(queryEmbedding: Embedding, options: VectorSearchOptions = {}): SearchResult[] {
  const {
    topK = 10, model, recent = false, alpha = 0.8, before, after,
    weightVector, weightRecency, weightPath, query = '',
    searchChunks = false, searchSymbols = false, searchModules = false, branch,
    negativeQueryEmbedding, negativeLambda, explain, earlyCut = 0,
    queryText, noCache = false, allowedHashes,
  } = options

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

  const useThreeSignal = weightVector !== undefined || weightRecency !== undefined || weightPath !== undefined
  const wv = weightVector ?? 0.7
  const wr = weightRecency ?? 0.2
  const wp = weightPath ?? 0.1
  const wTotal = wv + wr + wp || 1

  const { db, rawDb } = getActiveSession()
  const AUTO_CANDIDATE_LIMIT = 50_000

  const baseQuery = db.select({
    blobHash: embeddings.blobHash,
    vector: embeddings.vector,
    quantized: embeddings.quantized,
    quantMin: embeddings.quantMin,
    quantScale: embeddings.quantScale,
  }).from(embeddings)

  const conditions: SQL[] = []
  if (model) conditions.push(eq(embeddings.model, model))
  if (branch) conditions.push(sql`${embeddings.blobHash} IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ${branch})`)

  let filteredQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery
  if (earlyCut === 0 && !allowedHashes) {
    filteredQuery = (filteredQuery.orderBy(sql`RANDOM()`).limit(AUTO_CANDIDATE_LIMIT)) as typeof filteredQuery
  }
  const allRows = filteredQuery.all()

  let candidatePool: CandidateRow[] = allRows.map((r) => ({
    blobHash: r.blobHash,
    vector: r.vector as Buffer,
    quantized: r.quantized ?? null,
    quantMin: r.quantMin ?? null,
    quantScale: r.quantScale ?? null,
  }))

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
        blobHash: `\0module:${row.modulePath}`,
        vector: row.vector as Buffer,
        modulePath: row.modulePath,
      })
    }
  }

  const allHashes = [...new Set(
    candidatePool.filter((r) => !r.blobHash.startsWith('\0module:')).map((r) => r.blobHash),
  )]
  const filteredHashes = (before !== undefined || after !== undefined)
    ? new Set(filterByTimeRange(allHashes, before, after))
    : null

  const filteredPool = filteredHashes
    ? candidatePool.filter((r) => r.blobHash.startsWith('\0module:') || filteredHashes.has(r.blobHash))
    : candidatePool

  if (filteredPool.length === 0) return []

  const effectiveCut = earlyCut > 0 ? earlyCut
    : earlyCut === 0 && filteredPool.length > AUTO_CANDIDATE_LIMIT ? AUTO_CANDIDATE_LIMIT
    : 0
  const scoringPool = effectiveCut > 0
    ? reservoirSample(filteredPool, effectiveCut)
    : filteredPool

  const queryNorm = vectorNorm(queryEmbedding)
  const negEmbedding = options.negativeQueryEmbedding ?? null
  const negLambda = options.negativeLambda ?? 0.5
  const negNorm = negEmbedding ? vectorNorm(negEmbedding) : 0

  const needRecency = recent || useThreeSignal
  let recencyScores: Map<string, number> | null = null
  if (needRecency) {
    const candidateHashes = [...new Set(
      scoringPool.filter((r) => !r.blobHash.startsWith('\0module:')).map((r) => r.blobHash),
    )]
    const firstSeenMap = getFirstSeenMap(candidateHashes)
    recencyScores = computeRecencyScores(firstSeenMap)
  }

  let pathsByBlob: Map<string, string[]> | null = null
  if (useThreeSignal) {
    const hashes = [...new Set(
      scoringPool.filter((r) => !r.blobHash.startsWith('\0module:')).map((r) => r.blobHash),
    )]
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

  type FinalEntry = CandidateRow & { cosine: number; score: number }
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

  const blobHashes = [...new Set(
    topEntries.filter((b) => !b.blobHash.startsWith('\0module:')).map((b) => b.blobHash),
  )]
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

  const firstSeenMap = getFirstSeenMap(blobHashes)

  const results = topEntries.map((b) => {
    const firstSeen = firstSeenMap.get(b.blobHash)
    if (b.modulePath !== undefined) {
      const base: SearchResult = {
        blobHash: '',
        kind: 'module',
        paths: [b.modulePath],
        score: b.score,
        modulePath: b.modulePath,
      }
      if (options.explain) {
        base.signals = { cosine: b.cosine }
      }
      return base
    }

    const kind: SearchResultKind = b.symbolId !== undefined ? 'symbol'
      : b.chunkId !== undefined ? 'chunk'
      : 'file'
    const base: SearchResult = {
      blobHash: b.blobHash,
      kind,
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

  if (!noCache && !allowedHashes) {
    setCachedResults(cacheKey, results)
  }

  return results
}

export async function vectorSearchWithAnn(
  queryEmbedding: Embedding,
  options: VectorSearchOptions = {},
): Promise<SearchResult[]> {
  const { topK = 10, model, useVss, queryText, noCache = false } = options

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

  const resolvedModel = model ?? (process.env.GITSEMA_MODEL ?? 'nomic-embed-text')
  let shouldUseAnn = useVss === true

  if (!shouldUseAnn) {
    try {
      const { rawDb } = getActiveSession()
      const countRow = rawDb.prepare('SELECT COUNT(*) AS n FROM embeddings').get() as { n: number }
      if (countRow && countRow.n >= getVssThreshold()) shouldUseAnn = true
    } catch {
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

export function reservoirSample<T>(pool: T[], k: number): T[] {
  if (k >= pool.length) return pool
  const reservoir = pool.slice(0, k)
  for (let i = k; i < pool.length; i++) {
    const j = Math.floor(Math.random() * (i + 1))
    if (j < k) reservoir[j] = pool[i]
  }
  return reservoir
}

export function mergeSearchResults(
  a: SearchResult[],
  b: SearchResult[],
  topK: number,
): SearchResult[] {
  const best = new Map<string, SearchResult>()
  const dedupeKey = (r: SearchResult) => r.kind === 'module' && r.modulePath ? `\0module:${r.modulePath}` : r.blobHash
  for (const r of a) {
    const key = dedupeKey(r)
    const existing = best.get(key)
    if (!existing || r.score > existing.score) best.set(key, r)
  }
  for (const r of b) {
    const key = dedupeKey(r)
    const existing = best.get(key)
    if (!existing || r.score > existing.score) best.set(key, r)
  }
  return Array.from(best.values())
    .sort((x, y) => y.score - x.score)
    .slice(0, topK)
}

export function getBranchBlobHashSet(branch: string): Set<string> {
  const { rawDb } = getActiveSession()
  const rows = rawDb
    .prepare('SELECT DISTINCT blob_hash FROM blob_branches WHERE branch_name = ?')
    .all(branch) as Array<{ blob_hash: string }>
  return new Set(rows.map((r) => r.blob_hash))
}

export function vectorSearchWithSession(
  rawDb: InstanceType<typeof Database>,
  queryEmbedding: Embedding,
  opts: { topK?: number; model?: string } = {},
): SearchResult[] {
  const topK = opts.topK ?? 10
  const modelFilter = opts.model

  const rows = rawDb.prepare(`
    SELECT e.blob_hash, e.vector, e.model, GROUP_CONCAT(p.path, '|||') AS paths
    FROM embeddings e
    LEFT JOIN paths p ON p.blob_hash = e.blob_hash
    ${modelFilter ? 'WHERE e.model = ?' : ''}
    GROUP BY e.blob_hash, e.model
    LIMIT 10000
  `).all(...(modelFilter ? [modelFilter] : [])) as Array<{
    blob_hash: string; vector: Buffer; model: string; paths: string | null
  }>

  const scored: SearchResult[] = rows
    .map((r) => {
      const stored = new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4)
      const score = cosineSimilarity(queryEmbedding as number[], Array.from(stored))
      return {
        blobHash: r.blob_hash,
        score,
        paths: r.paths ? r.paths.split('|||') : [],
        model: r.model,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return scored
}
