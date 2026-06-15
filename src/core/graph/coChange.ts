/**
 * `gitsema co-change` (Phase 107, knowledge-graph §8): files that historically
 * change together, materialized as `co_change` edges by `gitsema graph build`.
 */

import { fileNodeKey } from './nodeKeys.js'
import type { GraphStore } from '../storage/types.js'

export interface CoChangeHit {
  path: string
  count: number
  firstSeenCommit?: string
  lastSeenCommit?: string
}

export interface CoChangeResult {
  path: string
  found: boolean
  hits: CoChangeHit[]
}

/**
 * Returns the files that most often change together with `path`, ordered by
 * co-occurrence count (descending). `found: false` means `path` has no node
 * in the graph (not indexed, or `gitsema graph build` has not been run).
 */
export async function coChange(graph: GraphStore, path: string, top = 10): Promise<CoChangeResult> {
  const nodeKey = fileNodeKey(path)
  const node = await graph.getNode(nodeKey)
  if (!node) return { path, found: false, hits: [] }

  const edges = await graph.edgesFor(nodeKey, { edgeTypes: ['co_change'], direction: 'out' })
  const hits: CoChangeHit[] = edges
    .map((e) => ({
      path: e.dstKey.startsWith('file:') ? e.dstKey.slice('file:'.length) : e.dstKey,
      count: e.observedCount ?? e.weight ?? 1,
      firstSeenCommit: e.firstSeenCommit,
      lastSeenCommit: e.lastSeenCommit,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top)

  return { path, found: true, hits }
}
