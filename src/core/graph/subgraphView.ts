/**
 * Unified subgraph model for Phase 112 (knowledge-graph §6/§9): the common
 * `{ nodes, edges }` shape every graph-traversal command (`graph neighbors`,
 * `graph path`, `blast-radius`, `relate`, `similar`, `hotspots`) renders
 * through, so the HTML force-graph (`htmlRenderer-graph.ts`) and the CLI
 * ASCII-tree view (`cli/lib/graphRender.ts`) only need to know about one
 * shape instead of six bespoke result types.
 *
 * Traversal-rooted commands (neighbors/blast-radius/relate/similar) delegate
 * to `GraphStore.subgraph()` — the real, depth-bounded node-induced subgraph
 * (Phase 108, §6) — rather than re-deriving edges from a flat `GraphHit[]`
 * list, which only carries the edge type of the hop that reached each node,
 * not the full path.
 */

import type { EdgeType, GraphEdgeRecord, GraphNodeRecord, GraphPath, GraphStore } from '../storage/types.js'
import { HOTSPOT_COUPLING_EDGE_TYPES, type HotspotScore } from './hotspots.js'

export interface RenderableSubgraph {
  /** Seed node(s) the subgraph was built from — rendered as the tree root(s) / highlighted in HTML. */
  rootKeys: string[]
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
  /** Optional per-node weight (e.g. hotspot risk) for sizing/labeling in the HTML view. */
  weights?: Record<string, number>
}

/** The node-induced subgraph within `depth` hops of one seed (Phase 108 `subgraph()`). */
export async function subgraphFromSeed(graph: GraphStore, seedKey: string, depth = 2): Promise<RenderableSubgraph> {
  const sub = await graph.subgraph(seedKey, depth)
  return { rootKeys: [seedKey], nodes: sub.nodes, edges: sub.edges }
}

/** Union of node-induced subgraphs around several seeds (e.g. callers + callees of one symbol). */
export async function subgraphFromSeeds(graph: GraphStore, seedKeys: string[], depth = 1): Promise<RenderableSubgraph> {
  const subs = await Promise.all(seedKeys.map((k) => graph.subgraph(k, depth)))
  const nodeByKey = new Map<string, GraphNodeRecord>()
  const edgeByKey = new Map<string, GraphEdgeRecord>()
  for (const s of subs) {
    for (const n of s.nodes) nodeByKey.set(n.nodeKey, n)
    for (const e of s.edges) edgeByKey.set(`${e.srcKey}|${e.dstKey}|${e.edgeType}`, e)
  }
  return { rootKeys: seedKeys, nodes: [...nodeByKey.values()], edges: [...edgeByKey.values()] }
}

/** The exact hop chain of a `graph path` result, as a linear subgraph from `fromKey` to `toKey`. */
export async function subgraphFromPath(graph: GraphStore, fromKey: string, toKey: string, path: GraphPath): Promise<RenderableSubgraph> {
  const keys = [fromKey, ...path.hops.map((h) => h.nodeKey)]
  const uniqueKeys = [...new Set(keys)]
  const nodes = (await Promise.all(uniqueKeys.map((k) => graph.getNode(k))))
    .filter((n): n is GraphNodeRecord => n !== undefined)

  const edges: GraphEdgeRecord[] = []
  let prev = fromKey
  for (const hop of path.hops) {
    edges.push(
      hop.reversed
        ? { srcKey: hop.nodeKey, dstKey: prev, edgeType: hop.edgeType }
        : { srcKey: prev, dstKey: hop.nodeKey, edgeType: hop.edgeType },
    )
    prev = hop.nodeKey
  }
  return { rootKeys: [fromKey, toKey], nodes, edges }
}

/** Hotspot files + the structural/co-change edges among them (no single seed — a top-K cohort instead). */
export async function subgraphFromHotspots(graph: GraphStore, hotspots: HotspotScore[]): Promise<RenderableSubgraph> {
  const keySet = new Set(hotspots.map((h) => h.nodeKey))
  const allNodes = await graph.allNodes()
  const nodes = allNodes.filter((n) => keySet.has(n.nodeKey))

  const edgeTypes: EdgeType[] = [...HOTSPOT_COUPLING_EDGE_TYPES, 'co_change']
  const allEdges = await graph.allEdges(edgeTypes)
  const edges = allEdges.filter((e) => keySet.has(e.srcKey) && keySet.has(e.dstKey))

  const weights: Record<string, number> = {}
  for (const h of hotspots) weights[h.nodeKey] = h.risk

  return { rootKeys: [...keySet], nodes, edges, weights }
}

/**
 * Suggested follow-up CLI invocations for a graph node — the HTML view's
 * "deep link" equivalent, surfaced as copyable commands rather than literal
 * hyperlinks since the target HTML files aren't guaranteed to exist yet.
 */
export function suggestedCommands(node: GraphNodeRecord): string[] {
  if (node.kind === 'file' && node.path) {
    return [
      `gitsema file-evolution "${node.path}" --out html:evolution.html`,
      `gitsema search "${node.path}" --out html:search.html`,
    ]
  }
  if (node.kind === 'external') {
    return [`gitsema search "${node.displayName}" --out html:search.html`]
  }
  return [
    `gitsema search "${node.displayName}" --out html:search.html`,
    `gitsema relate "${node.nodeKey}"`,
  ]
}
