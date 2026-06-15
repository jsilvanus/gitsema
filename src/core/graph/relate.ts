/**
 * `gitsema relate <symbol>` (Phase 109, knowledge-graph §7/§8): one view
 * combining structural callers/callees (labeled, depth 1) with semantically
 * similar blobs/symbols — "both lenses, lose neither".
 */

import type { GraphHit, GraphStore } from '../storage/types.js'
import { resolveNode, type ResolveNodeResult } from './resolveNode.js'
import { semanticNeighborsForNode, type SemanticHit } from './semanticNeighbors.js'

export interface RelateResult {
  resolved: ResolveNodeResult
  /** Direct (depth-1) callers of the resolved symbol. */
  callers: GraphHit[]
  /** Direct (depth-1) callees of the resolved symbol. */
  callees: GraphHit[]
  /** Semantically similar blobs/symbols. */
  similar: SemanticHit[]
  /** False when the storage backend doesn't support the semantic lookup. */
  semanticSupported: boolean
}

export interface RelateOptions {
  topK?: number
}

export async function relate(graph: GraphStore, identifier: string, opts: RelateOptions = {}): Promise<RelateResult> {
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') {
    return { resolved, callers: [], callees: [], similar: [], semanticSupported: true }
  }

  const topK = opts.topK ?? 10
  const [callers, callees, semantic] = await Promise.all([
    graph.callers(resolved.node.nodeKey, 1),
    graph.callees(resolved.node.nodeKey, 1),
    semanticNeighborsForNode(resolved.node, topK),
  ])

  return { resolved, callers, callees, similar: semantic.hits, semanticSupported: semantic.supported }
}
