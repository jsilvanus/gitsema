/**
 * Recursive-CTE traversal primitives over `edges`/`graph_nodes` for the
 * SQLite `GraphStore` (Phase 108, knowledge-graph §6).
 *
 * Each helper takes the active session's raw `better-sqlite3` handle and
 * returns plain rows; `SqliteGraphStore` (profile.ts) wraps these into the
 * `GraphHit`/`GraphPath`/`GraphSubgraph` shapes from `../types.js`.
 */

import type Database from 'better-sqlite3'
import { MAX_GRAPH_TRAVERSAL_DEPTH, type EdgeType } from '../types.js'

export function clampDepth(depth: number | undefined, fallback: number): number {
  const d = depth ?? fallback
  return Math.max(1, Math.min(Math.trunc(d), MAX_GRAPH_TRAVERSAL_DEPTH))
}

export interface WalkHit {
  nodeKey: string
  depth: number
  edgeType?: EdgeType
}

/**
 * Single-direction recursive walk from `start`, returning the shortest-depth
 * hit (with the edge type of that hop) for every node reached within
 * `maxDepth`. `direction: 'out'` follows `src_key -> dst_key`; `'in'` follows
 * `dst_key -> src_key`.
 */
function walkDirection(
  rawDb: InstanceType<typeof Database>,
  start: string,
  maxDepth: number,
  edgeTypes: EdgeType[] | undefined,
  direction: 'out' | 'in',
): WalkHit[] {
  const srcCol = direction === 'out' ? 'src_key' : 'dst_key'
  const dstCol = direction === 'out' ? 'dst_key' : 'src_key'
  const edgeFilter = edgeTypes && edgeTypes.length > 0
    ? `AND e.edge_type IN (${edgeTypes.map(() => '?').join(',')})`
    : ''

  const query = `
    WITH RECURSIVE walk(node_key, depth, edge_type) AS (
      SELECT ? AS node_key, 0 AS depth, NULL AS edge_type
      UNION ALL
      SELECT e.${dstCol}, w.depth + 1, e.edge_type
      FROM walk w JOIN edges e ON e.${srcCol} = w.node_key
      WHERE w.depth < ? ${edgeFilter}
    )
    SELECT node_key, depth, edge_type FROM (
      SELECT node_key, depth, edge_type,
        ROW_NUMBER() OVER (PARTITION BY node_key ORDER BY depth) AS rn
      FROM walk WHERE depth > 0
    ) WHERE rn = 1
  `
  const params: unknown[] = [start, maxDepth, ...(edgeTypes ?? [])]
  const rows = rawDb.prepare(query).all(...params) as Array<{ node_key: string; depth: number; edge_type: string | null }>
  return rows.map((r) => ({ nodeKey: r.node_key, depth: r.depth, edgeType: (r.edge_type ?? undefined) as EdgeType | undefined }))
}

/**
 * Typed neighborhood of `start` (Phase 108, knowledge-graph §6). `direction`
 * defaults to `'both'`. Depth is clamped via `clampDepth`.
 */
export function traverseNeighbors(
  rawDb: InstanceType<typeof Database>,
  start: string,
  opts: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both'; depth?: number; depthFallback?: number },
): WalkHit[] {
  const direction = opts.direction ?? 'both'
  const maxDepth = clampDepth(opts.depth, opts.depthFallback ?? 1)
  const merged = new Map<string, WalkHit>()

  if (direction === 'out' || direction === 'both') {
    for (const hit of walkDirection(rawDb, start, maxDepth, opts.edgeTypes, 'out')) {
      merged.set(hit.nodeKey, hit)
    }
  }
  if (direction === 'in' || direction === 'both') {
    for (const hit of walkDirection(rawDb, start, maxDepth, opts.edgeTypes, 'in')) {
      const existing = merged.get(hit.nodeKey)
      if (!existing || hit.depth < existing.depth) merged.set(hit.nodeKey, hit)
    }
  }
  return [...merged.values()]
}

export interface PathRow {
  depth: number
  hops: { nodeKey: string; edgeType: EdgeType; reversed: boolean }[]
}

/**
 * Shortest path from `from` to `to` over edges of any type, traversed in
 * either direction, via a recursive CTE that accumulates a delimited path
 * string. Returns `null` if unreachable within `MAX_GRAPH_TRAVERSAL_DEPTH`.
 */
export function findShortestPath(
  rawDb: InstanceType<typeof Database>,
  from: string,
  to: string,
  maxDepth: number = MAX_GRAPH_TRAVERSAL_DEPTH,
): PathRow | null {
  if (from === to) return { depth: 0, hops: [] }

  const query = `
    WITH RECURSIVE walk(node_key, depth, path) AS (
      SELECT ? AS node_key, 0 AS depth, ? AS path
      UNION ALL
      SELECT
        CASE WHEN e.src_key = w.node_key THEN e.dst_key ELSE e.src_key END,
        w.depth + 1,
        w.path || '|' || e.edge_type || '|' || (CASE WHEN e.src_key = w.node_key THEN '0' ELSE '1' END)
          || '|' || (CASE WHEN e.src_key = w.node_key THEN e.dst_key ELSE e.src_key END)
      FROM walk w
      JOIN edges e ON (e.src_key = w.node_key OR e.dst_key = w.node_key) AND e.src_key != e.dst_key
      WHERE w.depth < ?
    )
    SELECT path, depth FROM walk WHERE node_key = ? AND depth > 0 ORDER BY depth ASC LIMIT 1
  `
  const row = rawDb.prepare(query).get(from, from, maxDepth, to) as { path: string; depth: number } | undefined
  if (!row) return null

  const parts = row.path.split('|')
  const hops: PathRow['hops'] = []
  for (let i = 1; i < parts.length; i += 3) {
    hops.push({ edgeType: parts[i] as EdgeType, reversed: parts[i + 1] === '1', nodeKey: parts[i + 2] })
  }
  return { depth: row.depth, hops }
}
