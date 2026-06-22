import { describe, it, expect } from 'vitest'
import { findCycles } from '../src/core/graph/cycles.js'
import type {
  EdgeType,
  GraphEdgeRecord,
  GraphHit,
  GraphNodeRecord,
  GraphPath,
  GraphStore,
  GraphSubgraph,
} from '../src/core/storage/types.js'

/** Minimal in-memory GraphStore — findCycles only calls allEdges() and getNode(). */
function makeGraphStore(edges: GraphEdgeRecord[]): GraphStore {
  const notImplemented = (): never => {
    throw new Error('not implemented in test mock')
  }
  return {
    replaceAll: notImplemented,
    countNodes: notImplemented,
    countEdges: notImplemented,
    async getNode(nodeKey: string): Promise<GraphNodeRecord | undefined> {
      return { nodeKey, kind: 'file', displayName: nodeKey }
    },
    async allNodes(): Promise<GraphNodeRecord[]> {
      return []
    },
    async findByDisplayName(_displayName: string): Promise<GraphNodeRecord[]> {
      return []
    },
    async allEdges(_edgeTypes?: EdgeType[]): Promise<GraphEdgeRecord[]> {
      return edges
    },
    edgesFor: notImplemented,
    neighbors: notImplemented,
    callers: notImplemented,
    callees: notImplemented,
    path: notImplemented,
    subgraph: notImplemented,
  } as unknown as GraphStore
}

function edge(srcKey: string, dstKey: string): GraphEdgeRecord {
  return { srcKey, dstKey, edgeType: 'imports' }
}

describe('findCycles', () => {
  it('detects a simple 3-node cycle', async () => {
    const graph = makeGraphStore([edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])
    const hits = await findCycles(graph)
    expect(hits).toHaveLength(1)
    expect(hits[0].nodes[0]).toBe(hits[0].nodes[hits[0].nodes.length - 1])
  })

  it('returns no cycles for a long acyclic chain', async () => {
    const edges: GraphEdgeRecord[] = []
    for (let i = 0; i < 2000; i++) edges.push(edge(`n${i}`, `n${i + 1}`))
    const graph = makeGraphStore(edges)
    const hits = await findCycles(graph)
    expect(hits).toEqual([])
  })

  it('does not stack-overflow on a long acyclic chain that closes into a single cycle at the end', async () => {
    const edges: GraphEdgeRecord[] = []
    const depth = 20000 // well past MAX_DFS_DEPTH, to exercise the depth guard
    for (let i = 0; i < depth; i++) edges.push(edge(`n${i}`, `n${i + 1}`))
    edges.push(edge(`n${depth}`, 'n0')) // closes a cycle spanning the whole chain
    const graph = makeGraphStore(edges)
    // Must resolve without throwing (RangeError: Maximum call stack size exceeded).
    await expect(findCycles(graph)).resolves.toBeDefined()
  })
})
