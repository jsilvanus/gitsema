/**
 * Recursive-CTE traversal primitives over `edges`/`graph_nodes` for the
 * Postgres `GraphStore` (Phase 108, knowledge-graph §6). Mirrors
 * `../sqlite/graphTraversal.ts`; Postgres supports the same `WITH RECURSIVE`
 * + window-function shape as SQLite.
 */

import type { Pool } from 'pg'
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

async function walkDirection(
  pool: Pool,
  start: string,
  maxDepth: number,
  edgeTypes: EdgeType[] | undefined,
  direction: 'out' | 'in',
): Promise<WalkHit[]> {
  const srcCol = direction === 'out' ? 'src_key' : 'dst_key'
  const dstCol = direction === 'out' ? 'dst_key' : 'src_key'
  const edgeFilter = edgeTypes && edgeTypes.length > 0 ? 'AND e.edge_type = ANY($3::text[])' : ''
  const params: unknown[] = [start, maxDepth]
  if (edgeTypes && edgeTypes.length > 0) params.push(edgeTypes)

  const query = `
    WITH RECURSIVE walk(node_key, depth, edge_type) AS (
      SELECT $1::text AS node_key, 0 AS depth, NULL::text AS edge_type
      UNION ALL
      SELECT e.${dstCol}, w.depth + 1, e.edge_type
      FROM walk w JOIN edges e ON e.${srcCol} = w.node_key
      WHERE w.depth < $2 ${edgeFilter}
    )
    SELECT node_key, depth, edge_type FROM (
      SELECT node_key, depth, edge_type,
        ROW_NUMBER() OVER (PARTITION BY node_key ORDER BY depth) AS rn
      FROM walk WHERE depth > 0
    ) ranked WHERE rn = 1
  `
  const res = await pool.query(query, params)
  return res.rows.map((r: { node_key: string; depth: number; edge_type: string | null }) => ({
    nodeKey: r.node_key,
    depth: r.depth,
    edgeType: (r.edge_type ?? undefined) as EdgeType | undefined,
  }))
}

export async function traverseNeighbors(
  pool: Pool,
  start: string,
  opts: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both'; depth?: number; depthFallback?: number },
): Promise<WalkHit[]> {
  const direction = opts.direction ?? 'both'
  const maxDepth = clampDepth(opts.depth, opts.depthFallback ?? 1)
  const merged = new Map<string, WalkHit>()

  if (direction === 'out' || direction === 'both') {
    for (const hit of await walkDirection(pool, start, maxDepth, opts.edgeTypes, 'out')) {
      merged.set(hit.nodeKey, hit)
    }
  }
  if (direction === 'in' || direction === 'both') {
    for (const hit of await walkDirection(pool, start, maxDepth, opts.edgeTypes, 'in')) {
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

export async function findShortestPath(
  pool: Pool,
  from: string,
  to: string,
  maxDepth: number = MAX_GRAPH_TRAVERSAL_DEPTH,
): Promise<PathRow | null> {
  if (from === to) return { depth: 0, hops: [] }

  const query = `
    WITH RECURSIVE walk(node_key, depth, path) AS (
      SELECT $1::text AS node_key, 0 AS depth, $1::text AS path
      UNION ALL
      SELECT
        CASE WHEN e.src_key = w.node_key THEN e.dst_key ELSE e.src_key END,
        w.depth + 1,
        w.path || '|' || e.edge_type || '|' || (CASE WHEN e.src_key = w.node_key THEN '0' ELSE '1' END)
          || '|' || (CASE WHEN e.src_key = w.node_key THEN e.dst_key ELSE e.src_key END)
      FROM walk w
      JOIN edges e ON (e.src_key = w.node_key OR e.dst_key = w.node_key) AND e.src_key != e.dst_key
      WHERE w.depth < $2
    )
    SELECT path, depth FROM walk WHERE node_key = $3 AND depth > 0 ORDER BY depth ASC LIMIT 1
  `
  const res = await pool.query(query, [from, maxDepth, to])
  const row = res.rows[0] as { path: string; depth: number } | undefined
  if (!row) return null

  const parts = row.path.split('|')
  const hops: PathRow['hops'] = []
  for (let i = 1; i < parts.length; i += 3) {
    hops.push({ edgeType: parts[i] as EdgeType, reversed: parts[i + 1] === '1', nodeKey: parts[i + 2] })
  }
  return { depth: row.depth, hops }
}
