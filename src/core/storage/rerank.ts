/**
 * Shared re-ranking for the non-sqlite vector backends (review9 §6).
 *
 * Postgres (pgvector) and Qdrant both fetch a wide ANN-ordered candidate pool
 * from their vector store, then re-rank it in JS with gitsema's three-signal
 * logic (cosine + recency + path relevance) — the same trick `--vss` uses on
 * sqlite. This module holds that scoring/dedup/top-K step so the two adapters
 * share one implementation of the weighting formula. The per-backend I/O
 * (candidate queries, first/last-seen and path lookups) stays in each store.
 */

import { pathRelevanceScore } from '../search/analysis/vectorSearch.js'

/** A vector-store candidate awaiting re-ranking. `negCosine` is pgvector-only. */
export interface RerankCandidate {
  blobHash: string
  cosine: number
  negCosine?: number
  chunkId?: number
  startLine?: number
  endLine?: number
  symbolId?: number
  symbolName?: string
  symbolKind?: string
  language?: string
  modulePath?: string
}

export interface RerankOptions {
  query: string
  topK: number
  useThreeSignal: boolean
  wv: number
  wr: number
  wp: number
  wTotal: number
  recent: boolean
  alpha: number
  recencyScores: Map<string, number> | null
  pathsByBlob: Map<string, string[]>
  /**
   * Negative-example penalty weight. Pass only when a negative query embedding
   * was used (so `negCosine` is populated); leave undefined to disable the
   * penalty entirely. Only applied when neither three-signal nor `recent` wins.
   */
  negLambda?: number
}

export type Scored<C extends RerankCandidate> = C & { score: number }

/**
 * Apply gitsema's scoring (three-signal / recency-blend / plain cosine, plus an
 * optional negative-example penalty), dedupe by blob (or module path), and
 * return the top-K. Behavior matches the sqlite path's combination of signals.
 */
export function scoreAndDedupe<C extends RerankCandidate>(candidates: C[], o: RerankOptions): Scored<C>[] {
  const scored: Scored<C>[] = candidates.map((c) => {
    let score = c.cosine
    if (o.negLambda !== undefined && c.negCosine !== undefined) {
      score = c.cosine - o.negLambda * c.negCosine
    }
    if (o.useThreeSignal) {
      const recency = o.recencyScores?.get(c.blobHash) ?? 0
      const blobPaths = o.pathsByBlob.get(c.blobHash) ?? []
      const pathScore = blobPaths.length > 0 ? Math.max(...blobPaths.map((p) => pathRelevanceScore(o.query, p))) : 0
      score = (o.wv * c.cosine + o.wr * recency + o.wp * pathScore) / o.wTotal
    } else if (o.recent) {
      const recency = o.recencyScores?.get(c.blobHash) ?? 0
      score = o.alpha * c.cosine + (1 - o.alpha) * recency
    }
    return { ...c, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const dedupeKey = (c: Scored<C>) => (c.modulePath !== undefined ? `\0module:${c.modulePath}` : c.blobHash)
  const best = new Map<string, Scored<C>>()
  for (const c of scored) {
    const key = dedupeKey(c)
    const existing = best.get(key)
    if (!existing || c.score > existing.score) best.set(key, c)
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, o.topK)
}
