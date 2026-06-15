/**
 * `gitsema blast-radius <symbol>` (Phase 109, knowledge-graph §7/§8): "what
 * changes if I touch this" — structural dependents (who references this node,
 * via `neighbors(..., direction: 'in')`) and/or semantically similar blobs,
 * selected by `--lens`. The upgrade to `impact`'s semantic-only analysis.
 */

import type { EdgeType, GraphHit, GraphStore } from '../storage/types.js'
import { resolveNode, type ResolveNodeResult } from './resolveNode.js'
import { semanticNeighborsForNode, type SemanticHit } from './semanticNeighbors.js'
import type { Lens } from '../../cli/lib/lens.js'

/** Edge types that represent "depends on" relationships for blast-radius purposes. */
export const BLAST_RADIUS_EDGE_TYPES: EdgeType[] = ['calls', 'imports', 'extends', 'implements', 'references']

export interface BlastRadiusResult {
  resolved: ResolveNodeResult
  lens: Lens
  /** Nodes that (transitively) depend on the resolved node — empty unless lens is structural/hybrid. */
  structural: GraphHit[]
  /** Semantically similar blobs/symbols — empty unless lens is semantic/hybrid. */
  semantic: SemanticHit[]
  /** False when the semantic lens was requested but the storage backend doesn't support it. */
  semanticSupported: boolean
}

export interface BlastRadiusOptions {
  lens?: Lens
  depth?: number
  topK?: number
  edgeTypes?: EdgeType[]
}

export async function blastRadius(graph: GraphStore, identifier: string, opts: BlastRadiusOptions = {}): Promise<BlastRadiusResult> {
  const lens = opts.lens ?? 'hybrid'
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') {
    return { resolved, lens, structural: [], semantic: [], semanticSupported: true }
  }

  const topK = opts.topK ?? 10
  const structural = lens === 'semantic'
    ? []
    : await graph.neighbors(resolved.node.nodeKey, {
      edgeTypes: opts.edgeTypes ?? BLAST_RADIUS_EDGE_TYPES,
      direction: 'in',
      depth: opts.depth,
    })

  let semantic: SemanticHit[] = []
  let semanticSupported = true
  if (lens !== 'structural') {
    const result = await semanticNeighborsForNode(resolved.node, topK)
    semantic = result.hits
    semanticSupported = result.supported
  }

  return { resolved, lens, structural, semantic, semanticSupported }
}
