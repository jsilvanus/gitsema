/**
 * `gitsema cycles` (Phase 107, knowledge-graph §8): detects cycles in the
 * structural graph (by default, `imports` edges — import cycles).
 */

import type { EdgeType, GraphStore } from '../storage/types.js'

const MAX_CYCLES = 50

export interface CycleHit {
  /** Node keys forming the cycle, in order (first === last). */
  nodes: string[]
  displayNames: string[]
}

/**
 * Detects simple cycles among edges of the given types (default: `imports`)
 * via DFS with a recursion stack. Each distinct cycle is reported once
 * (rotated to start at its lexicographically smallest node).
 */
export async function findCycles(graph: GraphStore, edgeTypes: EdgeType[] = ['imports']): Promise<CycleHit[]> {
  const edges = await graph.allEdges(edgeTypes)
  const adjacency = new Map<string, string[]>()
  for (const e of edges) {
    if (e.srcKey === e.dstKey) continue // self-loops aren't interesting cycles
    const list = adjacency.get(e.srcKey) ?? []
    list.push(e.dstKey)
    adjacency.set(e.srcKey, list)
  }

  const seen = new Set<string>()
  const found: string[][] = []
  const onStack = new Set<string>()
  const stack: string[] = []
  const visited = new Set<string>()

  // Iterative DFS with an explicit call-stack (each frame: node + next adjacency
  // index to visit), rather than native recursion — a long acyclic chain can be
  // arbitrarily deep, and recursing once per node would stack-overflow Node well
  // before any interesting depth.
  function dfs(start: string): void {
    const frames: { node: string; idx: number }[] = [{ node: start, idx: 0 }]
    visited.add(start)
    onStack.add(start)
    stack.push(start)

    while (frames.length > 0) {
      if (found.length >= MAX_CYCLES) break
      const frame = frames[frames.length - 1]
      const neighbors = adjacency.get(frame.node) ?? []

      if (frame.idx >= neighbors.length) {
        stack.pop()
        onStack.delete(frame.node)
        frames.pop()
        continue
      }

      const next = neighbors[frame.idx]
      frame.idx++

      if (onStack.has(next)) {
        const idx = stack.indexOf(next)
        const cycle = stack.slice(idx)
        const normalized = normalizeCycle([...cycle, next])
        const key = normalized.join('->')
        if (!seen.has(key)) {
          seen.add(key)
          found.push(normalized)
        }
      } else if (!visited.has(next)) {
        visited.add(next)
        onStack.add(next)
        stack.push(next)
        frames.push({ node: next, idx: 0 })
      }
    }

    // Unwind any frames left on the stack (e.g. due to the MAX_CYCLES break).
    while (frames.length > 0) {
      const frame = frames.pop()!
      stack.pop()
      onStack.delete(frame.node)
    }
  }

  for (const node of adjacency.keys()) {
    if (found.length >= MAX_CYCLES) break
    if (!visited.has(node)) dfs(node)
  }

  const nodes = new Map<string, string>()
  for (const node of new Set(found.flat())) {
    const n = await graph.getNode(node)
    nodes.set(node, n?.displayName ?? node)
  }

  return found.map((cycle) => ({
    nodes: cycle,
    displayNames: cycle.map((k) => nodes.get(k) ?? k),
  }))
}

/** Rotates a cycle (first === last) so it starts at its lexicographically smallest node, for dedup. */
function normalizeCycle(cycle: string[]): string[] {
  const body = cycle.slice(0, -1) // drop the repeated last element
  let minIdx = 0
  for (let i = 1; i < body.length; i++) {
    if (body[i] < body[minIdx]) minIdx = i
  }
  const rotated = [...body.slice(minIdx), ...body.slice(0, minIdx)]
  return [...rotated, rotated[0]]
}
