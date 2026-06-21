import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { neighbors } from '../../core/graph/traversal.js'
import { subgraphFromHits } from '../../core/graph/subgraphView.js'
import type { EdgeType } from '../../core/storage/types.js'
import { parseOutputSpec } from '../../utils/outputSink.js'
import { emitSubgraphOutputs } from '../lib/graphOutput.js'

export interface GraphNeighborsCommandOptions {
  edgeTypes?: string
  direction?: string
  depth?: string
  out?: string[]
}

export async function graphNeighborsCommand(node: string, options: GraphNeighborsCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const edgeTypes = options.edgeTypes
    ? options.edgeTypes.split(',').map((s) => s.trim()).filter(Boolean) as EdgeType[]
    : undefined
  const direction = (options.direction as 'out' | 'in' | 'both' | undefined) ?? 'both'
  const depth = options.depth !== undefined ? parseInt(options.depth, 10) : undefined

  const result = await neighbors(profile.graph, node, { edgeTypes, direction, depth })

  if (result.resolved.status === 'not-found') {
    console.log(`No graph node found for "${node}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.`)
    return
  }
  if (result.resolved.status === 'ambiguous') {
    console.log(`"${node}" is ambiguous — matches multiple symbols:`)
    for (const c of result.resolved.candidates) console.log(`  ${c.nodeKey}`)
    return
  }

  const resolvedNode = result.resolved.node

  if (options.out && options.out.length > 0) {
    const sinks = options.out.map(parseOutputSpec)
    const sub = await subgraphFromHits(profile.graph, resolvedNode.nodeKey, result.hits, direction)
    emitSubgraphOutputs(sinks, sub, `Neighbors of ${resolvedNode.displayName}`)
    return
  }

  console.log(`Neighbors of ${resolvedNode.displayName} (${resolvedNode.nodeKey}):\n`)

  if (result.hits.length === 0) {
    console.log('  (none)')
    return
  }
  for (const hit of result.hits) {
    const edge = hit.edgeType ? `[${hit.edgeType}] ` : ''
    console.log(`  ${edge}${hit.displayName}  (depth ${hit.depth})`)
  }
}
