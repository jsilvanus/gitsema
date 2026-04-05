import { getActiveSession } from '../db/sqlite.js'
import { paths } from '../db/schema.js'
import { inArray } from 'drizzle-orm'
import { vectorSearch, type VectorSearchOptions } from './vectorSearch.js'
import type { SearchResult, Embedding } from '../models/types.js'

export interface HybridSearchOptions extends VectorSearchOptions {
  /**
   * Weight for the BM25 (lexical) signal in the final score.
   * The vector signal gets weight `(1 - bm25Weight)`.
   * Default: 0.3 — slightly favour semantic similarity.
   */
  bm25Weight?: number
}

interface Bm25Row {
  blob_hash: string
  bm25_score: number
}

/**
 * Performs a hybrid search combining:
 *   - Vector (semantic) similarity via cosine distance
 *   - BM25 keyword matching via SQLite FTS5
 *
 * The final score for each blob is:
 *   finalScore = (1 - bm25Weight) * vectorScore + bm25Weight * normalizedBm25
 *
 * where `normalizedBm25` maps BM25 ranks into [0, 1].
 *
 * Only blobs that appear in the FTS5 index (`blob_fts`) participate in the
 * BM25 stage; blobs without FTS content still appear if found by vector search,
 * but receive a BM25 contribution of 0.
 */
export function hybridSearch(
  query: string,
  queryEmbedding: Embedding,
  options: HybridSearchOptions = {},
): SearchResult[] {
  const { bm25Weight = 0.3, topK = 10, ...vectorOptions } = options

  // --- Stage 1: Vector search (fetch more candidates so we can re-rank) ---
  const vectorK = Math.max(topK * 3, 50)
  const vectorResults = vectorSearch(queryEmbedding, { ...vectorOptions, topK: vectorK })

  if (vectorResults.length === 0) return []

  // --- Stage 2: BM25 search via FTS5 ---
  const { db, rawDb: raw } = getActiveSession()

  // FTS5 bm25() returns negative values (more negative = better match).
  // We fetch up to vectorK rows to have a comparable candidate pool.
  let bm25Rows: Bm25Row[] = []
  try {
    bm25Rows = raw
      .prepare(
        `SELECT blob_hash, bm25(blob_fts) AS bm25_score
         FROM blob_fts
         WHERE blob_fts MATCH ?
         ORDER BY bm25_score
         LIMIT ?`,
      )
      .all(sanitizeFtsQuery(query), vectorK) as Bm25Row[]
  } catch {
    // FTS5 query error (e.g. malformed query string) — fall back to vector-only
    return vectorResults.slice(0, topK)
  }

  // --- Stage 3: Normalize BM25 scores into [0, 1] ---
  // bm25() returns negative numbers; the most negative is the best match.
  // We negate them so higher = better, then normalise to [0, 1].
  const bm25Map = new Map<string, number>()
  if (bm25Rows.length > 0) {
    const rawScores = bm25Rows.map((r) => -r.bm25_score)  // now positive, higher = better
    const minScore = Math.min(...rawScores)
    const maxScore = Math.max(...rawScores)
    const range = maxScore - minScore

    for (const row of bm25Rows) {
      const normalised = range === 0 ? 1.0 : (-row.bm25_score - minScore) / range
      bm25Map.set(row.blob_hash, normalised)
    }
  }

  // --- Stage 4: Normalise vector scores into [0, 1] ---
  const vectorScores = vectorResults.map((r) => r.score)
  const minVec = Math.min(...vectorScores)
  const maxVec = Math.max(...vectorScores)
  const vecRange = maxVec - minVec

  const vectorMap = new Map<string, { result: SearchResult; normScore: number }>()
  for (const r of vectorResults) {
    const normVec = vecRange === 0 ? 1.0 : (r.score - minVec) / vecRange
    vectorMap.set(r.blobHash, { result: r, normScore: normVec })
  }

  // --- Stage 5: Merge and re-rank ---
  // Union of blobs from both stages.
  const allHashes = new Set<string>([
    ...vectorResults.map((r) => r.blobHash),
    ...bm25Rows.map((r) => r.blob_hash),
  ])

  // Resolve paths for any BM25-only blobs not already in vectorResults
  const missingHashes = [...allHashes].filter((h) => !vectorMap.has(h))
  const pathsByBlob = new Map<string, string[]>()
  if (missingHashes.length > 0) {
    const BATCH = 500
    for (let i = 0; i < missingHashes.length; i += BATCH) {
      const batch = missingHashes.slice(i, i + BATCH)
      const rows = db
        .select({ blobHash: paths.blobHash, path: paths.path })
        .from(paths)
        .where(inArray(paths.blobHash, batch))
        .all()
      for (const row of rows) {
        const list = pathsByBlob.get(row.blobHash) ?? []
        list.push(row.path)
        pathsByBlob.set(row.blobHash, list)
      }
    }
  }

  const merged: Array<SearchResult & { hybridScore: number }> = []

  for (const blobHash of allHashes) {
    const vec = vectorMap.get(blobHash)
    const bm25 = bm25Map.get(blobHash) ?? 0
    const normVec = vec?.normScore ?? 0

    const hybridScore = (1 - bm25Weight) * normVec + bm25Weight * bm25

    const base: SearchResult = vec?.result ?? {
      blobHash,
      paths: pathsByBlob.get(blobHash) ?? [],
      score: 0,
    }

    merged.push({ ...base, score: hybridScore, hybridScore })
  }

  merged.sort((a, b) => b.hybridScore - a.hybridScore)
  return merged.slice(0, topK).map(({ hybridScore: _h, ...r }) => r)
}

/**
 * Sanitizes a free-text query for use as an FTS5 MATCH expression.
 * Wraps each token in double quotes so special FTS5 characters are escaped.
 * Tokens are joined with spaces; FTS5 treats space-separated quoted tokens as
 * an implicit AND, so all tokens must appear.
 */
function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
  return tokens.join(' ')
}
