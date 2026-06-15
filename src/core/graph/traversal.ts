/**
 * `gitsema graph callers|callees|neighbors|path` (Phase 108, knowledge-graph
 * §6/§8): thin wrappers over `GraphStore`'s recursive-CTE traversal
 * primitives, resolving user-supplied identifiers via `resolveNode`.
 */

import type { EdgeType, GraphHit, GraphPath, GraphStore } from '../storage/types.js'
import { resolveNode, type ResolveNodeResult } from './resolveNode.js'

export interface TraversalResult {
  resolved: ResolveNodeResult
  hits: GraphHit[]
}

/** Reverse `calls` traversal — who (transitively) calls `identifier`. */
export async function callers(graph: GraphStore, identifier: string, depth?: number): Promise<TraversalResult> {
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') return { resolved, hits: [] }
  return { resolved, hits: await graph.callers(resolved.node.nodeKey, depth) }
}

/** Forward `calls` traversal — what `identifier` (transitively) calls. */
export async function callees(graph: GraphStore, identifier: string, depth?: number): Promise<TraversalResult> {
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') return { resolved, hits: [] }
  return { resolved, hits: await graph.callees(resolved.node.nodeKey, depth) }
}

/** Typed neighborhood of `identifier` (any edge kinds by default). */
export async function neighbors(
  graph: GraphStore,
  identifier: string,
  opts: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both'; depth?: number } = {},
): Promise<TraversalResult> {
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') return { resolved, hits: [] }
  return { resolved, hits: await graph.neighbors(resolved.node.nodeKey, opts) }
}

export interface PathResult {
  from: ResolveNodeResult
  to: ResolveNodeResult
  path: GraphPath | null
}

/** Shortest typed path from `a` to `b` — "how does A reach B". */
export async function path(graph: GraphStore, a: string, b: string): Promise<PathResult> {
  const from = await resolveNode(graph, a)
  const to = await resolveNode(graph, b)
  if (from.status !== 'found' || to.status !== 'found') {
    return { from, to, path: null }
  }
  return { from, to, path: await graph.path(from.node.nodeKey, to.node.nodeKey) }
}
