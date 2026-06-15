/**
 * Resolves a user-supplied identifier (file path, symbol qualified name, or a
 * literal `node_key`) to a `graph_nodes` entry. Shared by `deps`, `cycles`,
 * and future traversal commands (Phase 108+).
 */

import { fileNodeKey } from './nodeKeys.js'
import type { GraphNodeRecord, GraphStore } from '../storage/types.js'

export type ResolveNodeResult =
  | { status: 'found'; node: GraphNodeRecord }
  | { status: 'not-found' }
  | { status: 'ambiguous'; candidates: GraphNodeRecord[] }

/**
 * Resolution order:
 *   1. Literal `node_key` (`file:...`, `symbol:...`, `external:...`)
 *   2. `file:<identifier>` — a file path
 *   3. Any symbol node whose `displayName` (qualified name) equals `identifier`
 */
export async function resolveNode(graph: GraphStore, identifier: string): Promise<ResolveNodeResult> {
  if (identifier.startsWith('file:') || identifier.startsWith('symbol:') || identifier.startsWith('external:')) {
    const node = await graph.getNode(identifier)
    return node ? { status: 'found', node } : { status: 'not-found' }
  }

  const fileNode = await graph.getNode(fileNodeKey(identifier))
  if (fileNode) return { status: 'found', node: fileNode }

  const all = await graph.allNodes()
  const candidates = all.filter((n) => n.kind !== 'file' && n.kind !== 'external' && n.displayName === identifier)
  if (candidates.length === 1) return { status: 'found', node: candidates[0] }
  if (candidates.length > 1) return { status: 'ambiguous', candidates }
  return { status: 'not-found' }
}
