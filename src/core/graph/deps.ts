/**
 * `gitsema deps` (Phase 107, knowledge-graph §8): the import/dependency
 * closure of a file or symbol, or its dependents with `--reverse`.
 *
 * Traverses `imports` / `calls` / `extends` / `implements` edges. This is a
 * simple BFS closure, not a general traversal primitive — `neighbors`/`path`/
 * `callers`/`callees` land in Phase 108.
 */

import type { EdgeType, GraphStore } from '../storage/types.js'
import { resolveNode, type ResolveNodeResult } from './resolveNode.js'

export const DEPS_EDGE_TYPES: EdgeType[] = ['imports', 'calls', 'extends', 'implements']

export interface DepsHit {
  nodeKey: string
  displayName: string
  kind: string
  depth: number
  edgeType: EdgeType
}

export interface DepsResult {
  resolved: ResolveNodeResult
  hits: DepsHit[]
}

export interface DepsOptions {
  reverse?: boolean
  depth?: number
  edgeTypes?: EdgeType[]
}

/**
 * BFS closure over the structural graph starting at `identifier`.
 * `--reverse` walks `dst -> src` (dependents) instead of `src -> dst` (dependencies).
 */
export async function deps(graph: GraphStore, identifier: string, opts: DepsOptions = {}): Promise<DepsResult> {
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') return { resolved, hits: [] }

  const edgeTypes = opts.edgeTypes ?? DEPS_EDGE_TYPES
  const direction = opts.reverse ? 'in' : 'out'
  const maxDepth = opts.depth ?? Infinity

  const visited = new Set<string>([resolved.node.nodeKey])
  const hits: DepsHit[] = []
  let frontier = [resolved.node.nodeKey]
  let depth = 0

  while (frontier.length > 0 && depth < maxDepth) {
    depth++
    const next: string[] = []
    for (const key of frontier) {
      const edges = await graph.edgesFor(key, { edgeTypes, direction })
      for (const e of edges) {
        const otherKey = direction === 'out' ? e.dstKey : e.srcKey
        if (visited.has(otherKey)) continue
        visited.add(otherKey)
        const node = await graph.getNode(otherKey)
        hits.push({
          nodeKey: otherKey,
          displayName: node?.displayName ?? otherKey,
          kind: node?.kind ?? 'unknown',
          depth,
          edgeType: e.edgeType,
        })
        next.push(otherKey)
      }
    }
    frontier = next
  }

  return { resolved, hits }
}
