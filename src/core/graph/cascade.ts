/**
 * Cascade query planner (Phase 110, knowledge-graph §7/§10).
 *
 * Implements the four-stage fusion pipeline that powers the `hybrid` lens for
 * query-driven fusion paths:
 *
 *   1. FTS filter     — BM25 pre-filter narrows the candidate field (optional;
 *                       skipped when the profile has no FTS store).
 *   2. Vector expand  — cosine similarity over the query embedding produces the
 *                       semantic candidate set.
 *   3. Graph traversal — top semantic hits are mapped to `file` graph nodes and
 *                       expanded along structural edges (calls/imports/…), so
 *                       structurally-adjacent code surfaces even when it is not
 *                       semantically similar.
 *   4. Merge / rerank — the semantic and structural candidate sets are unioned
 *                       and reranked by a lens-weighted blend; every hit is
 *                       labeled with which lens(es) contributed.
 *
 * Design contract: `lens: 'semantic'` runs stages 1–2 only and returns the
 * vector ranking unchanged (byte-for-byte identical to a plain `vectorSearch`),
 * so wiring the cascade behind a command's `hybrid` default never alters its
 * semantic-lens output. Structural stages are sqlite-relational-only; on
 * backends without a relational graph the planner degrades to semantic-only
 * with `structuralSupported: false`.
 */

import type { Embedding } from '../models/types.js'
import type { GraphNodeRecord, GraphStore, EdgeType } from '../storage/types.js'
import { vectorSearch } from '../search/analysis/vectorSearch.js'
import { getCachedStorageProfile } from '../storage/resolveProfile.js'
import { fileNodeKey } from './nodeKeys.js'
import type { Lens } from '../../cli/lib/lens.js'

/** Structural edge kinds the cascade expands along during stage 3. */
export const CASCADE_EDGE_TYPES: EdgeType[] = ['calls', 'imports', 'extends', 'implements', 'references']

/** A single fused, lens-labeled result from the cascade planner. */
export interface CascadeHit {
  blobHash: string
  paths: string[]
  displayName: string
  /** Final fused score in [0, 1] under the active lens. */
  score: number
  /** Which lens(es) contributed a non-zero signal to this hit. */
  lenses: Array<'semantic' | 'structural'>
  /** Cosine similarity to the query (0 when the hit came only from graph expansion). */
  semanticScore: number
  /** Graph proximity 1/(1+hops) from a semantic anchor (0 when not structurally reached). */
  structuralScore: number
}

export interface CascadeResult {
  lens: Lens
  /** Stages actually executed, in order (for explainability / tests). */
  stages: string[]
  /** False when a structural stage was requested but the backend can't serve it. */
  structuralSupported: boolean
  /** Size of the FTS (BM25) pre-filter candidate set, or 0 when no FTS store ran. */
  ftsCandidateCount: number
  hits: CascadeHit[]
}

export interface CascadeOptions {
  query: string
  queryEmbedding: Embedding
  graph: GraphStore
  lens?: Lens
  topK?: number
  /** Structural blend weight for the `hybrid` lens (default 0.3, mirroring `lensWeights`). */
  weightStructural?: number
  /** Candidate over-fetch multiplier for the FTS/vector stages before rerank (default 3). */
  expand?: number
  /** Number of top semantic hits used as graph-traversal anchors (default 5). */
  anchorCount?: number
}

/**
 * Runs the cascade planner. See the module docstring for the stage contract.
 */
export async function planCascade(opts: CascadeOptions): Promise<CascadeResult> {
  const lens = opts.lens ?? 'hybrid'
  const topK = opts.topK ?? 10
  const expand = opts.expand ?? 3
  const anchorCount = opts.anchorCount ?? 5
  const weightStructural = opts.weightStructural ?? 0.3
  const stages: string[] = []

  // -- Stage 1: FTS filter (optional pre-filter) ----------------------------
  const profile = getCachedStorageProfile()
  let ftsCandidates: Set<string> | null = null
  if (profile.fts && opts.query.trim() !== '') {
    try {
      const ftsHits = await profile.fts.search(opts.query, topK * expand)
      ftsCandidates = new Set(ftsHits.map((h) => h.blobHash))
      stages.push('fts-filter')
    } catch {
      ftsCandidates = null
    }
  }
  const ftsCandidateCount = ftsCandidates?.size ?? 0

  // -- Stage 2: vector expand -----------------------------------------------
  const vecHits = await vectorSearch(opts.queryEmbedding, { topK: topK * expand, noCache: true })
  stages.push('vector-expand')

  const semanticScores = new Map<string, { score: number; paths: string[] }>()
  for (const r of vecHits) {
    // When an FTS pre-filter ran, prefer in-set candidates but keep the rest so
    // a thin/absent FTS index never starves the result.
    semanticScores.set(r.blobHash, { score: r.score, paths: r.paths ?? [] })
  }

  // Semantic lens short-circuits — identical to a plain vectorSearch ranking.
  if (lens === 'semantic') {
    const hits: CascadeHit[] = vecHits.slice(0, topK).map((r) => ({
      blobHash: r.blobHash,
      paths: r.paths ?? [],
      displayName: (r.paths && r.paths[0]) ?? r.blobHash.slice(0, 12),
      score: r.score,
      lenses: ['semantic'],
      semanticScore: r.score,
      structuralScore: 0,
    }))
    return { lens, stages, structuralSupported: true, ftsCandidateCount, hits }
  }

  // -- Stage 3: graph traversal --------------------------------------------
  const structuralScores = new Map<string, { score: number; paths: string[]; displayName: string }>()
  let structuralSupported = true
  try {
    const anchors = vecHits.slice(0, anchorCount)
    for (const anchor of anchors) {
      const path = anchor.paths?.[0]
      if (!path) continue
      const anchorNode = await opts.graph.getNode(fileNodeKey(path))
      if (!anchorNode) continue
      const reached = await opts.graph.neighbors(anchorNode.nodeKey, {
        edgeTypes: CASCADE_EDGE_TYPES,
        direction: 'both',
        depth: 1,
      })
      for (const hit of reached) {
        const node = await opts.graph.getNode(hit.nodeKey)
        recordStructural(structuralScores, node, hit.depth)
      }
    }
    if (anchors.length > 0) stages.push('graph-traversal')
  } catch {
    // UnsupportedGraphStore (e.g. Qdrant) — degrade to semantic-only.
    structuralSupported = false
    structuralScores.clear()
  }

  // -- Stage 4: merge / rerank ----------------------------------------------
  stages.push('merge-rerank')
  const allHashes = new Set<string>([...semanticScores.keys(), ...structuralScores.keys()])
  const wv = 0.7
  const ws = weightStructural
  const hits: CascadeHit[] = []
  for (const blobHash of allHashes) {
    const sem = semanticScores.get(blobHash)
    const str = structuralScores.get(blobHash)
    const semanticScore = sem?.score ?? 0
    const structuralScore = str?.score ?? 0

    if (lens === 'structural' && structuralScore === 0) continue

    let score: number
    const lenses: Array<'semantic' | 'structural'> = []
    if (lens === 'structural') {
      // Pure graph ranking — the semantic score never drives a structural hit.
      score = structuralScore
      lenses.push('structural')
    } else {
      // hybrid — label by which signal actually contributed.
      score = (wv * semanticScore + ws * structuralScore) / (wv + ws)
      if (semanticScore > 0) lenses.push('semantic')
      if (structuralScore > 0) lenses.push('structural')
    }

    const paths = sem?.paths.length ? sem.paths : (str?.paths ?? [])
    hits.push({
      blobHash,
      paths,
      displayName: str?.displayName ?? paths[0] ?? blobHash.slice(0, 12),
      score,
      lenses,
      semanticScore,
      structuralScore,
    })
  }
  // The FTS pre-filter is non-destructive: members get a small rank boost so
  // keyword-confirmed hits float up, but non-members are never dropped (a thin
  // or absent FTS index must never starve the result).
  if (ftsCandidates && ftsCandidates.size > 0) {
    for (const h of hits) {
      if (ftsCandidates.has(h.blobHash)) h.score = Math.min(1, h.score + 0.05)
    }
  }
  hits.sort((a, b) => b.score - a.score)
  return { lens, stages, structuralSupported, ftsCandidateCount, hits: hits.slice(0, topK) }
}

function recordStructural(
  map: Map<string, { score: number; paths: string[]; displayName: string }>,
  node: GraphNodeRecord | undefined,
  hops: number,
): void {
  if (!node || !node.currentBlobHash) return
  const score = 1 / (1 + hops)
  const existing = map.get(node.currentBlobHash)
  if (existing && existing.score >= score) return
  map.set(node.currentBlobHash, {
    score,
    paths: node.path ? [node.path] : [],
    displayName: node.displayName,
  })
}
