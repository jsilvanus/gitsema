/**
 * `gitsema unused` (Phase 109, knowledge-graph §7/§8): symbols/files with no
 * inbound `calls`/`imports` edges — the structural complement to the semantic
 * `dead-concepts` command.
 */

import type { EdgeType, GraphNodeRecord, GraphStore } from '../storage/types.js'

export const UNUSED_EDGE_TYPES: EdgeType[] = ['calls', 'imports']
export const UNUSED_NODE_KINDS = ['file', 'function', 'class', 'method']

export interface UnusedOptions {
  /** Inbound edge types that count as "used" (default: calls, imports). */
  edgeTypes?: EdgeType[]
  /** Node kinds to consider (default: file + function/class/method symbol kinds). */
  kinds?: string[]
}

export interface UnusedResult {
  nodes: GraphNodeRecord[]
}

export async function unused(graph: GraphStore, opts: UnusedOptions = {}): Promise<UnusedResult> {
  const edgeTypes = opts.edgeTypes ?? UNUSED_EDGE_TYPES
  const kinds = opts.kinds ?? UNUSED_NODE_KINDS

  const [allNodes, allEdges] = await Promise.all([
    graph.allNodes(),
    graph.allEdges(edgeTypes),
  ])

  const referenced = new Set<string>()
  for (const e of allEdges) referenced.add(e.dstKey)

  const nodes = allNodes.filter((n) =>
    !n.isExternal &&
    kinds.includes(n.kind) &&
    !referenced.has(n.nodeKey),
  )

  return { nodes }
}
