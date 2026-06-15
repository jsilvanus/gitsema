import type { ResolveNodeResult } from '../../core/graph/resolveNode.js'
import type { BlastRadiusResult } from '../../core/graph/blastRadius.js'
import type { GraphNodeRecord } from '../../core/storage/types.js'

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
