/**
 * `GraphStore` for non-relational storage profiles (Phase 107, knowledge-graph
 * §3.3/§10 deviation #4). The structural graph (`graph_nodes`/`edges`) lives
 * in the relational store; Qdrant is vectors-only and has no relational
 * companion table for it (unlike `MetadataStore`/`FtsStore`, which delegate
 * to a Postgres companion). Every method throws so callers fail loud instead
 * of silently no-opping — `gitsema index doctor` should surface this as a
 * graph-unavailable backend, not a silent empty graph.
 */

import type { EdgeType, GraphEdgeRecord, GraphHit, GraphNodeRecord, GraphPath, GraphStore, GraphSubgraph } from './types.js'

const ERROR_MESSAGE = 'graph queries require a relational backend (Qdrant storage profiles do not support gitsema graph build/co-change/deps/cycles)'

export class UnsupportedGraphStore implements GraphStore {
  async replaceAll(_nodes: GraphNodeRecord[], _edges: GraphEdgeRecord[]): Promise<void> {
    throw new Error(ERROR_MESSAGE)
  }

  async countNodes(): Promise<number> {
    throw new Error(ERROR_MESSAGE)
  }

  async countEdges(): Promise<number> {
    throw new Error(ERROR_MESSAGE)
  }

  async getNode(_nodeKey: string): Promise<GraphNodeRecord | undefined> {
    throw new Error(ERROR_MESSAGE)
  }

  async allNodes(): Promise<GraphNodeRecord[]> {
    throw new Error(ERROR_MESSAGE)
  }

  async allEdges(_edgeTypes?: EdgeType[]): Promise<GraphEdgeRecord[]> {
    throw new Error(ERROR_MESSAGE)
  }

  async edgesFor(_nodeKey: string, _opts?: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both' }): Promise<GraphEdgeRecord[]> {
    throw new Error(ERROR_MESSAGE)
  }

  async neighbors(_key: string, _opts?: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both'; depth?: number }): Promise<GraphHit[]> {
    throw new Error(ERROR_MESSAGE)
  }

  async callers(_key: string, _depth?: number): Promise<GraphHit[]> {
    throw new Error(ERROR_MESSAGE)
  }

  async callees(_key: string, _depth?: number): Promise<GraphHit[]> {
    throw new Error(ERROR_MESSAGE)
  }

  async path(_from: string, _to: string): Promise<GraphPath | null> {
    throw new Error(ERROR_MESSAGE)
  }

  async subgraph(_seed: string, _depth?: number): Promise<GraphSubgraph> {
    throw new Error(ERROR_MESSAGE)
  }
}
