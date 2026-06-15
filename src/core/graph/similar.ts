/**
 * `gitsema similar <symbol> --lens structural|semantic|hybrid` (Phase 109,
 * knowledge-graph §7/§8): structural similarity ranks nodes by the Jaccard
 * overlap of their outgoing edge targets (same call/import "shape" as the
 * resolved node); semantic similarity ranks by embedding cosine similarity.
 */

import type { EdgeType, GraphStore } from '../storage/types.js'
import { resolveNode, type ResolveNodeResult } from './resolveNode.js'
import { semanticNeighborsForNode, type SemanticHit } from './semanticNeighbors.js'
import type { Lens } from '../../cli/lib/lens.js'

export interface StructuralSimilarHit {
  nodeKey: string
  displayName: string
  kind: string
  /** Jaccard similarity of outgoing edge targets, in [0, 1]. */
  jaccard: number
  /** Number of shared outgoing edge targets. */
  shared: number
}

export interface SimilarResult {
  resolved: ResolveNodeResult
  lens: Lens
  /** Nodes with a similar call/import shape — empty unless lens is structural/hybrid. */
  structural: StructuralSimilarHit[]
  /** Semantically similar blobs/symbols — empty unless lens is semantic/hybrid. */
  semantic: SemanticHit[]
  /** False when the semantic lens was requested but the storage backend doesn't support it. */
  semanticSupported: boolean
}

export interface SimilarOptions {
  lens?: Lens
  topK?: number
  /** Edge type whose outgoing targets define a node's "shape" (default: `calls` for symbols, `imports` for files). */
  edgeType?: EdgeType
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): { score: number; shared: number } {
  let shared = 0
  for (const k of a) if (b.has(k)) shared++
  const union = a.size + b.size - shared
  return { score: union === 0 ? 0 : shared / union, shared }
}

export async function similar(graph: GraphStore, identifier: string, opts: SimilarOptions = {}): Promise<SimilarResult> {
  const lens = opts.lens ?? 'hybrid'
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') {
    return { resolved, lens, structural: [], semantic: [], semanticSupported: true }
  }

  const topK = opts.topK ?? 10
  const edgeType: EdgeType = opts.edgeType ?? (resolved.node.kind === 'file' ? 'imports' : 'calls')

  let structural: StructuralSimilarHit[] = []
  if (lens !== 'semantic') {
    const edges = await graph.allEdges([edgeType])
    const setsBySrc = new Map<string, Set<string>>()
    for (const e of edges) {
      const set = setsBySrc.get(e.srcKey) ?? new Set<string>()
      set.add(e.dstKey)
      setsBySrc.set(e.srcKey, set)
    }

    const targetSet = setsBySrc.get(resolved.node.nodeKey)
    if (targetSet && targetSet.size > 0) {
      const allNodes = await graph.allNodes()
      const byKey = new Map(allNodes.map((n) => [n.nodeKey, n]))
      const hits: StructuralSimilarHit[] = []
      for (const [nodeKey, set] of setsBySrc) {
        if (nodeKey === resolved.node.nodeKey) continue
        const node = byKey.get(nodeKey)
        if (!node || node.kind !== resolved.node.kind) continue
        const { score, shared } = jaccard(targetSet, set)
        if (shared === 0) continue
        hits.push({ nodeKey, displayName: node.displayName, kind: node.kind, jaccard: score, shared })
      }
      hits.sort((a, b) => b.jaccard - a.jaccard || b.shared - a.shared)
      structural = hits.slice(0, topK)
    }
  }

  let semantic: SemanticHit[] = []
  let semanticSupported = true
  if (lens !== 'structural') {
    const result = await semanticNeighborsForNode(resolved.node, topK)
    semantic = result.hits
    semanticSupported = result.supported
  }

  return { resolved, lens, structural, semantic, semanticSupported }
}
