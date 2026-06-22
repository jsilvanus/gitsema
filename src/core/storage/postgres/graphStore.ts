/**
 * Postgres-backed `GraphStore` (Phase 107, knowledge-graph §3.3/§6).
 *
 * `replaceAll` truncates and rebuilds `graph_nodes`/`edges` in one
 * transaction, mirroring the SQLite implementation. Postgres supports
 * recursive CTEs over `edges`, which later traversal phases (108+) will use.
 */

import type { Pool } from 'pg'
import { ensurePostgresSchema } from './migrations.js'
import type { EdgeType, GraphEdgeRecord, GraphHit, GraphNodeRecord, GraphPath, GraphPathHop, GraphStore, GraphSubgraph } from '../types.js'
import { MAX_GRAPH_TRAVERSAL_DEPTH } from '../types.js'
import { traverseNeighbors, findShortestPath, clampDepth, type WalkHit } from './graphTraversal.js'

export class PostgresGraphStore implements GraphStore {
  constructor(private readonly pool: Pool) {}

  async replaceAll(nodes: GraphNodeRecord[], edgeRecords: GraphEdgeRecord[]): Promise<void> {
    await ensurePostgresSchema(this.pool)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM edges')
      await client.query('DELETE FROM graph_nodes')

      for (const n of nodes) {
        await client.query(
          `INSERT INTO graph_nodes (node_key, kind, display_name, path, repo_id, current_blob_hash, is_external)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [n.nodeKey, n.kind, n.displayName, n.path ?? null, n.repoId ?? null, n.currentBlobHash ?? null, n.isExternal ? 1 : 0],
        )
      }

      for (const e of edgeRecords) {
        await client.query(
          `INSERT INTO edges (src_key, dst_key, edge_type, weight, confidence, first_seen_commit, last_seen_commit, observed_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [e.srcKey, e.dstKey, e.edgeType, e.weight ?? 1, e.confidence ?? 1, e.firstSeenCommit ?? null, e.lastSeenCommit ?? null, e.observedCount ?? 1],
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async countNodes(): Promise<number> {
    await ensurePostgresSchema(this.pool)
    const res = await this.pool.query('SELECT COUNT(*) AS n FROM graph_nodes')
    return Number(res.rows[0].n)
  }

  async countEdges(): Promise<number> {
    await ensurePostgresSchema(this.pool)
    const res = await this.pool.query('SELECT COUNT(*) AS n FROM edges')
    return Number(res.rows[0].n)
  }

  async getNode(nodeKey: string): Promise<GraphNodeRecord | undefined> {
    await ensurePostgresSchema(this.pool)
    const res = await this.pool.query('SELECT * FROM graph_nodes WHERE node_key = $1', [nodeKey])
    return res.rows[0] ? rowToNode(res.rows[0]) : undefined
  }

  async allNodes(): Promise<GraphNodeRecord[]> {
    await ensurePostgresSchema(this.pool)
    const res = await this.pool.query('SELECT * FROM graph_nodes')
    return res.rows.map(rowToNode)
  }

  async findByDisplayName(displayName: string): Promise<GraphNodeRecord[]> {
    await ensurePostgresSchema(this.pool)
    const res = await this.pool.query('SELECT * FROM graph_nodes WHERE display_name = $1', [displayName])
    return res.rows.map(rowToNode)
  }

  async allEdges(edgeTypes?: EdgeType[]): Promise<GraphEdgeRecord[]> {
    await ensurePostgresSchema(this.pool)
    const res = edgeTypes && edgeTypes.length > 0
      ? await this.pool.query('SELECT * FROM edges WHERE edge_type = ANY($1)', [edgeTypes])
      : await this.pool.query('SELECT * FROM edges')
    return res.rows.map(rowToEdge)
  }

  async edgesFor(nodeKey: string, opts?: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both' }): Promise<GraphEdgeRecord[]> {
    await ensurePostgresSchema(this.pool)
    const direction = opts?.direction ?? 'both'
    const edgeTypes = opts?.edgeTypes
    const collected: GraphEdgeRecord[] = []

    if (direction === 'out' || direction === 'both') {
      const res = await this.pool.query('SELECT * FROM edges WHERE src_key = $1', [nodeKey])
      collected.push(...res.rows.map(rowToEdge))
    }
    if (direction === 'in' || direction === 'both') {
      const res = await this.pool.query('SELECT * FROM edges WHERE dst_key = $1', [nodeKey])
      collected.push(...res.rows.map(rowToEdge))
    }

    return edgeTypes && edgeTypes.length > 0
      ? collected.filter((e) => edgeTypes.includes(e.edgeType))
      : collected
  }

  async neighbors(key: string, opts?: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both'; depth?: number }): Promise<GraphHit[]> {
    await ensurePostgresSchema(this.pool)
    const hits = await traverseNeighbors(this.pool, key, { ...opts, depthFallback: 1 })
    return this.hydrateHits(hits)
  }

  async callers(key: string, depth?: number): Promise<GraphHit[]> {
    await ensurePostgresSchema(this.pool)
    const hits = await traverseNeighbors(this.pool, key, { edgeTypes: ['calls'], direction: 'in', depth, depthFallback: MAX_GRAPH_TRAVERSAL_DEPTH })
    return this.hydrateHits(hits)
  }

  async callees(key: string, depth?: number): Promise<GraphHit[]> {
    await ensurePostgresSchema(this.pool)
    const hits = await traverseNeighbors(this.pool, key, { edgeTypes: ['calls'], direction: 'out', depth, depthFallback: MAX_GRAPH_TRAVERSAL_DEPTH })
    return this.hydrateHits(hits)
  }

  async path(from: string, to: string): Promise<GraphPath | null> {
    await ensurePostgresSchema(this.pool)
    const found = await findShortestPath(this.pool, from, to)
    if (!found) return null

    const hops: GraphPathHop[] = []
    for (const hop of found.hops) {
      const node = await this.getNode(hop.nodeKey)
      hops.push({
        nodeKey: hop.nodeKey,
        displayName: node?.displayName ?? hop.nodeKey,
        edgeType: hop.edgeType,
        reversed: hop.reversed,
      })
    }
    return { from, to, hops }
  }

  async subgraph(seed: string, depth?: number): Promise<GraphSubgraph> {
    await ensurePostgresSchema(this.pool)
    const maxDepth = clampDepth(depth, MAX_GRAPH_TRAVERSAL_DEPTH)
    const hits = await traverseNeighbors(this.pool, seed, { direction: 'both', depth: maxDepth })
    const nodeKeys = [...new Set([seed, ...hits.map((h) => h.nodeKey)])]

    if (nodeKeys.length === 0) return { nodes: [], edges: [] }

    const nodesRes = await this.pool.query('SELECT * FROM graph_nodes WHERE node_key = ANY($1::text[])', [nodeKeys])
    const edgesRes = await this.pool.query(
      'SELECT * FROM edges WHERE src_key = ANY($1::text[]) AND dst_key = ANY($1::text[])',
      [nodeKeys],
    )
    return { nodes: nodesRes.rows.map(rowToNode), edges: edgesRes.rows.map(rowToEdge) }
  }

  private async hydrateHits(hits: WalkHit[]): Promise<GraphHit[]> {
    if (hits.length === 0) return []
    const nodeKeys = hits.map((h) => h.nodeKey)
    const res = await this.pool.query('SELECT * FROM graph_nodes WHERE node_key = ANY($1::text[])', [nodeKeys])
    const byKey = new Map(res.rows.map((r: GraphNodeRow) => [r.node_key, rowToNode(r)]))
    return hits
      .map((h) => {
        const node = byKey.get(h.nodeKey)
        return {
          nodeKey: h.nodeKey,
          displayName: node?.displayName ?? h.nodeKey,
          kind: node?.kind ?? 'unknown',
          depth: h.depth,
          edgeType: h.edgeType,
        }
      })
      .sort((a, b) => a.depth - b.depth || a.nodeKey.localeCompare(b.nodeKey))
  }
}

interface GraphNodeRow {
  node_key: string
  kind: string
  display_name: string
  path: string | null
  repo_id: string | null
  current_blob_hash: string | null
  is_external: number | null
}

interface EdgeRow {
  src_key: string
  dst_key: string
  edge_type: string
  weight: number | string | null
  confidence: number | string | null
  first_seen_commit: string | null
  last_seen_commit: string | null
  observed_count: number | string | null
}

function rowToNode(row: GraphNodeRow): GraphNodeRecord {
  return {
    nodeKey: row.node_key,
    kind: row.kind,
    displayName: row.display_name,
    path: row.path ?? undefined,
    repoId: row.repo_id ?? undefined,
    currentBlobHash: row.current_blob_hash ?? undefined,
    isExternal: !!row.is_external,
  }
}

function rowToEdge(row: EdgeRow): GraphEdgeRecord {
  return {
    srcKey: row.src_key,
    dstKey: row.dst_key,
    edgeType: row.edge_type as EdgeType,
    weight: row.weight !== null ? Number(row.weight) : 1,
    confidence: row.confidence !== null ? Number(row.confidence) : 1,
    firstSeenCommit: row.first_seen_commit ?? undefined,
    lastSeenCommit: row.last_seen_commit ?? undefined,
    observedCount: row.observed_count !== null ? Number(row.observed_count) : 1,
  }
}
