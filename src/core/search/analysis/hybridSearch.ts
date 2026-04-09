import { getActiveSession } from '../../db/sqlite.js'
import { paths } from '../../db/schema.js'
import { inArray } from 'drizzle-orm'
import { vectorSearch, type VectorSearchOptions } from './vectorSearch.js'
import type { SearchResult, Embedding } from '../../models/types.js'

export interface HybridSearchOptions extends VectorSearchOptions {
  bm25Weight?: number
}

interface Bm25Row {
  blob_hash: string
  bm25_score: number
}

export function hybridSearch(
  query: string,
  queryEmbedding: Embedding,
  options: HybridSearchOptions = {},
): SearchResult[] {
  const { bm25Weight = 0.3, topK = 10, ...vectorOptions } = options

  const vectorK = Math.max(topK * 3, 50)
  const vectorResults = vectorSearch(queryEmbedding, { ...vectorOptions, topK: vectorK })

  if (vectorResults.length === 0) return []

  const { db, rawDb: raw } = getActiveSession()

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
    return vectorResults.slice(0, topK)
  }

  const bm25Map = new Map<string, number>()
  if (bm25Rows.length > 0) {
    let minScore = Infinity
    let maxScore = -Infinity
    for (const row of bm25Rows) {
      const s = -row.bm25_score
      if (s < minScore) minScore = s
      if (s > maxScore) maxScore = s
    }
    const range = maxScore - minScore

    for (const row of bm25Rows) {
      // §11.2 — when all candidates share an identical BM25 score (common
      // with small hit sets), `range === 0` used to set every normalised
      // score to 1.0, which inflated hybrid scores beyond the intended
      // weight distribution. 0.5 is the neutral midpoint.
      const normalised = range === 0 ? 0.5 : (-row.bm25_score - minScore) / range
      bm25Map.set(row.blob_hash, normalised)
    }
  }

  let minVec = Infinity
  let maxVec = -Infinity
  for (const r of vectorResults) {
    if (r.score < minVec) minVec = r.score
    if (r.score > maxVec) maxVec = r.score
  }
  const vecRange = maxVec - minVec

  const vectorMap = new Map<string, { result: SearchResult; normScore: number }>()
  for (const r of vectorResults) {
    const normVec = vecRange === 0 ? 1.0 : (r.score - minVec) / vecRange
    vectorMap.set(r.blobHash, { result: r, normScore: normVec })
  }

  const allHashes = new Set<string>([
    ...vectorResults.map((r) => r.blobHash),
    ...bm25Rows.map((r) => r.blob_hash),
  ])

  const missingHashes = [...allHashes].filter((h) => !vectorMap.has(h))
  const pathsByBlob = new Map<string, string[]>()
  if (missingHashes.length > 0) {
    const rows = db
      .select({ blobHash: paths.blobHash, path: paths.path })
      .from(paths)
      .where(inArray(paths.blobHash, missingHashes))
      .all()
    for (const row of rows) {
      const list = pathsByBlob.get(row.blobHash) ?? []
      list.push(row.path)
      pathsByBlob.set(row.blobHash, list)
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

function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
  return tokens.join(' ')
}
