import type { ResolveNodeResult } from '../../core/graph/resolveNode.js'
import type { BlastRadiusResult } from '../../core/graph/blastRadius.js'
import type { GraphEdgeRecord, GraphNodeRecord } from '../../core/storage/types.js'
import type { RenderableSubgraph } from '../../core/graph/subgraphView.js'

/** Shared "not found" / "ambiguous" message for `resolveNode()` results. */
export function renderResolutionError(label: string, resolved: ResolveNodeResult): string {
  if (resolved.status === 'ambiguous') {
    const candidates = resolved.candidates.map((c) => `  ${c.nodeKey}`).join('\n')
    return `"${label}" is ambiguous — matches multiple symbols:\n${candidates}`
  }
  return `No graph node found for "${label}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.`
}

/**
 * Renders a `BlastRadiusResult` as human-readable text. Shared by
 * `blast-radius` and `impact --lens`. The caller must have already checked
 * `result.resolved.status === 'found'`.
 */
export function renderBlastRadius(result: BlastRadiusResult, node: GraphNodeRecord): string {
  const lines: string[] = []
  lines.push(`Blast radius of ${node.displayName} (${node.nodeKey}) — lens: ${result.lens}`, '')

  if (result.lens !== 'semantic') {
    lines.push('Structural dependents (who references this):')
    if (result.structural.length === 0) {
      lines.push('  (none)')
    } else {
      for (const hit of result.structural) {
        const edge = hit.edgeType ? `[${hit.edgeType}] ` : ''
        lines.push(`  ${edge}${hit.displayName}  (depth ${hit.depth})`)
      }
    }
    lines.push('')
  }

  if (result.lens !== 'structural') {
    lines.push('Semantically related:')
    if (!result.semanticSupported) {
      lines.push('  (not supported on this storage backend)')
    } else if (result.semantic.length === 0) {
      lines.push('  (none)')
    } else {
      for (const hit of result.semantic) {
        const label = hit.symbolName ?? hit.paths[0] ?? '(unknown)'
        lines.push(`  ${hit.score.toFixed(3)}  ${label}`)
      }
    }
  }

  return lines.join('\n')
}

// ─── Unified subgraph rendering (Phase 112, knowledge-graph §9) ──────────────

function buildOutAdjacency(edges: GraphEdgeRecord[]): Map<string, GraphEdgeRecord[]> {
  const adj = new Map<string, GraphEdgeRecord[]>()
  for (const e of edges) {
    const list = adj.get(e.srcKey) ?? []
    list.push(e)
    adj.set(e.srcKey, list)
  }
  return adj
}

/**
 * Renders a `RenderableSubgraph` as an indented ASCII tree, rooted at
 * `sub.rootKeys` — the unified CLI/text-mode subgraph view (Phase 112,
 * knowledge-graph §9) shared by every graph-traversal command's `--out text`.
 */
export function renderGraphTree(sub: RenderableSubgraph): string {
  if (sub.nodes.length === 0) return '(empty subgraph)'
  const byKey = new Map(sub.nodes.map((n) => [n.nodeKey, n]))
  const outAdj = buildOutAdjacency(sub.edges)
  const lines: string[] = []
  const visited = new Set<string>()

  const labelFor = (key: string): string => {
    const node = byKey.get(key)
    const base = node ? `${node.displayName} [${node.kind}]` : key
    const weight = sub.weights?.[key]
    return weight !== undefined ? `${base}  (risk ${weight.toFixed(3)})` : base
  }

  function visit(key: string, prefix: string, isRoot: boolean, isLast: boolean, edgeType?: string): void {
    const connector = isRoot ? '' : isLast ? '└─ ' : '├─ '
    const edgeLabel = edgeType ? `-[${edgeType}]-> ` : ''
    const already = visited.has(key)
    lines.push(`${prefix}${connector}${edgeLabel}${labelFor(key)}${already ? '  (...)' : ''}`)
    if (already) return
    visited.add(key)

    const children = outAdj.get(key) ?? []
    const childPrefix = isRoot ? prefix : prefix + (isLast ? '   ' : '│  ')
    children.forEach((e, i) => visit(e.dstKey, childPrefix, false, i === children.length - 1, e.edgeType))
  }

  const roots = sub.rootKeys.length > 0 ? sub.rootKeys : [sub.nodes[0].nodeKey]
  roots.forEach((r) => visit(r, '', true, true))
  return lines.join('\n')
}

/** Markdown nested-bullet-list rendering of a `RenderableSubgraph` — the markdown sink's body. */
export function renderGraphMarkdown(sub: RenderableSubgraph): string {
  if (sub.nodes.length === 0) return '_(empty subgraph)_'
  const byKey = new Map(sub.nodes.map((n) => [n.nodeKey, n]))
  const outAdj = buildOutAdjacency(sub.edges)
  const lines: string[] = []
  const visited = new Set<string>()

  const labelFor = (key: string): string => {
    const node = byKey.get(key)
    const base = node ? `**${node.displayName}** _(${node.kind})_` : key
    const weight = sub.weights?.[key]
    return weight !== undefined ? `${base} — risk ${weight.toFixed(3)}` : base
  }

  function visit(key: string, depth: number, edgeType?: string): void {
    const indent = '  '.repeat(depth)
    const edgeLabel = edgeType ? `\`${edgeType}\` → ` : ''
    const already = visited.has(key)
    lines.push(`${indent}- ${edgeLabel}${labelFor(key)}${already ? ' _(already shown)_' : ''}`)
    if (already) return
    visited.add(key)
    for (const e of outAdj.get(key) ?? []) visit(e.dstKey, depth + 1, e.edgeType)
  }

  const roots = sub.rootKeys.length > 0 ? sub.rootKeys : [sub.nodes[0].nodeKey]
  roots.forEach((r) => visit(r, 0))
  return lines.join('\n')
}
