/**
 * Structural enrichment helper (Phase 110, knowledge-graph §8).
 *
 * Given a file path, returns lightweight structural facts from the knowledge
 * graph — caller/callee/dependent counts and the strongest co-change partner —
 * so query/diff-driven commands (`code-review`, `explain`, `guide`, `triage`)
 * can surface grounded context like "called by N callers" or "co-changes with
 * file X 80% of the time" when run under a structural/hybrid lens.
 *
 * Returns `{ found: false }` (never throws) when the path has no graph node or
 * the backend can't serve graph queries, so callers can enrich opportunistically
 * without guarding every call site. Semantic-lens callers should simply not
 * invoke this, keeping their output byte-for-byte unchanged.
 */

import type { GraphStore } from '../storage/types.js'
import { fileNodeKey } from './nodeKeys.js'

export interface CoChangePartner {
  path: string
  count: number
  /** Share of this file's total co-change weight, in [0, 1]. */
  ratio: number
}

export interface StructuralContext {
  found: boolean
  nodeKey?: string
  displayName?: string
  /** Inbound `calls` edges (direct). */
  callerCount: number
  /** Outbound `calls` edges (direct). */
  calleeCount: number
  /** Inbound `imports`/`calls`/`references` edges (direct dependents). */
  dependentCount: number
  /** Top co-change partners by co-occurrence count. */
  coChange: CoChangePartner[]
}

const EMPTY: StructuralContext = { found: false, callerCount: 0, calleeCount: 0, dependentCount: 0, coChange: [] }

export async function structuralContextForPath(
  graph: GraphStore,
  path: string,
  opts: { topCoChange?: number } = {},
): Promise<StructuralContext> {
  const topCoChange = opts.topCoChange ?? 3
  try {
    const normalised = path.replace(/\\/g, '/').replace(/^\.\//, '')
    const node = await graph.getNode(fileNodeKey(normalised))
    if (!node) return EMPTY

    const [inbound, outbound, coEdges] = await Promise.all([
      graph.edgesFor(node.nodeKey, { edgeTypes: ['calls', 'imports', 'references'], direction: 'in' }),
      graph.edgesFor(node.nodeKey, { edgeTypes: ['calls'], direction: 'out' }),
      graph.edgesFor(node.nodeKey, { edgeTypes: ['co_change'], direction: 'out' }),
    ])

    const callerCount = inbound.filter((e) => e.edgeType === 'calls').length
    const dependentCount = inbound.length
    const calleeCount = outbound.length

    const total = coEdges.reduce((s, e) => s + (e.observedCount ?? e.weight ?? 1), 0)
    const coChange: CoChangePartner[] = coEdges
      .map((e) => {
        const count = e.observedCount ?? e.weight ?? 1
        return {
          path: e.dstKey.startsWith('file:') ? e.dstKey.slice('file:'.length) : e.dstKey,
          count,
          ratio: total > 0 ? count / total : 0,
        }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, topCoChange)

    return { found: true, nodeKey: node.nodeKey, displayName: node.displayName, callerCount, calleeCount, dependentCount, coChange }
  } catch {
    return EMPTY
  }
}

/** One-line human summary of a structural context, or undefined when not found. */
export function formatStructuralContext(ctx: StructuralContext): string | undefined {
  if (!ctx.found) return undefined
  const parts: string[] = []
  parts.push(`${ctx.callerCount} caller${ctx.callerCount === 1 ? '' : 's'}`)
  parts.push(`${ctx.calleeCount} callee${ctx.calleeCount === 1 ? '' : 's'}`)
  if (ctx.coChange.length > 0) {
    const top = ctx.coChange[0]
    parts.push(`co-changes with ${top.path} (${Math.round(top.ratio * 100)}%)`)
  }
  return parts.join(', ')
}
