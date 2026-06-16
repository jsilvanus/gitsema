/**
 * `gitsema relate <symbol>` (Phase 109, knowledge-graph §7/§8): one view
 * combining structural callers/callees (labeled, depth 1) with semantically
 * similar blobs/symbols — "both lenses, lose neither".
 */

import type { GraphHit, GraphStore } from '../storage/types.js'
import { resolveNode, type ResolveNodeResult } from './resolveNode.js'
import { semanticNeighborsForNode, type SemanticHit } from './semanticNeighbors.js'
import type { Lens } from '../../cli/lib/lens.js'

export interface RelateResult {
  resolved: ResolveNodeResult
  lens: Lens
  /** Direct (depth-1) callers of the resolved symbol — empty under lens=semantic. */
  callers: GraphHit[]
  /** Direct (depth-1) callees of the resolved symbol — empty under lens=semantic. */
  callees: GraphHit[]
  /** Semantically similar blobs/symbols — empty under lens=structural. */
  similar: SemanticHit[]
  /** False when the storage backend doesn't support the semantic lookup. */
  semanticSupported: boolean
}

export interface RelateOptions {
  topK?: number
  lens?: Lens
}

export async function relate(graph: GraphStore, identifier: string, opts: RelateOptions = {}): Promise<RelateResult> {
  const lens = opts.lens ?? 'hybrid'
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') {
    return { resolved, lens, callers: [], callees: [], similar: [], semanticSupported: true }
  }

  const topK = opts.topK ?? 10
  const wantStructural = lens !== 'semantic'
  const wantSemantic = lens !== 'structural'
  const [callers, callees, semantic] = await Promise.all([
    wantStructural ? graph.callers(resolved.node.nodeKey, 1) : Promise.resolve([]),
    wantStructural ? graph.callees(resolved.node.nodeKey, 1) : Promise.resolve([]),
    wantSemantic ? semanticNeighborsForNode(resolved.node, topK) : Promise.resolve({ supported: true, hits: [] }),
  ])

  return { resolved, lens, callers, callees, similar: semantic.hits, semanticSupported: semantic.supported }
}
