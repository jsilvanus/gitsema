import { vectorSearch, type VectorSearchOptions } from './vectorSearch.js'
import type { SearchResult, Embedding } from '../../models/types.js'
import { getCachedStorageProfile } from '../../storage/resolveProfile.js'
import type { Bm25Hit } from '../../storage/types.js'

export interface HybridSearchOptions extends VectorSearchOptions {
  bm25Weight?: number
}

/**
 * Combines vector similarity with BM25 keyword matching, routed through the
 * active `StorageProfile` (Phase 102 §1). Vector candidates come from
 * `profile.vectors.search()` (sqlite / pgvector / Qdrant, via `vectorSearch`)
 * and keyword candidates from `profile.fts.search()` (FTS5 / tsvector /
 * pg_search). Score fusion stays backend-independent: both signals are
 * normalised to [0,1] before blending, so the math is identical regardless of
 * which `FtsStore`/`VectorStore` produced the raw scores. When `profile.fts`
 * is `null` (no keyword store configured), hybrid degrades to vector-only.
 */
export async function hybridSearch(
  query: string,
  queryEmbedding: Embedding,
  options: HybridSearchOptions = {},
): Promise<SearchResult[]> {
  const { bm25Weight = 0.3, topK = 10, ...vectorOptions } = options

  const vectorK = Math.max(topK * 3, 50)
  const vectorResults = await vectorSearch(queryEmbedding, { ...vectorOptions, topK: vectorK })

  if (vectorResults.length === 0) return []

  const profile = getCachedStorageProfile()
  if (!profile.fts) return vectorResults.slice(0, topK)

  let bm25Hits: Bm25Hit[] = []
  try {
    bm25Hits = await profile.fts.search(query, vectorK)
  } catch {
    return vectorResults.slice(0, topK)
  }

  const bm25Map = new Map<string, number>()
  if (bm25Hits.length > 0) {
    let minScore = Infinity
    let maxScore = -Infinity
    for (const hit of bm25Hits) {
      const s = -hit.score
      if (s < minScore) minScore = s
      if (s > maxScore) maxScore = s
    }
    const range = maxScore - minScore

    for (const hit of bm25Hits) {
      // §11.2 — when all candidates share an identical BM25 score (common
      // with small hit sets), `range === 0` used to set every normalised
      // score to 1.0, which inflated hybrid scores beyond the intended
      // weight distribution. 0.5 is the neutral midpoint.
      const normalised = range === 0 ? 0.5 : (-hit.score - minScore) / range
      bm25Map.set(hit.blobHash, normalised)
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
    ...bm25Hits.map((h) => h.blobHash),
  ])

  const missingHashes = [...allHashes].filter((h) => !vectorMap.has(h))
  let pathsByBlob = new Map<string, string[]>()
  if (missingHashes.length > 0) {
    pathsByBlob = await profile.metadata.pathsFor(missingHashes)
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
