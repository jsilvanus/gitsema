import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { path } from '../../core/graph/traversal.js'
import { subgraphFromPath } from '../../core/graph/subgraphView.js'
import { parseOutputSpec } from '../../utils/outputSink.js'
import { emitSubgraphOutputs } from '../lib/graphOutput.js'

export interface GraphPathCommandOptions {
  out?: string[]
}

export async function graphPathCommand(a: string, b: string, options: GraphPathCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const result = await path(profile.graph, a, b)

  if (result.from.status === 'not-found') {
    console.log(`No graph node found for "${a}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.`)
    return
  }
  if (result.from.status === 'ambiguous') {
    console.log(`"${a}" is ambiguous — matches multiple symbols:`)
    for (const c of result.from.candidates) console.log(`  ${c.nodeKey}`)
    return
  }
  if (result.to.status === 'not-found') {
    console.log(`No graph node found for "${b}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.`)
    return
  }
  if (result.to.status === 'ambiguous') {
    console.log(`"${b}" is ambiguous — matches multiple symbols:`)
    for (const c of result.to.candidates) console.log(`  ${c.nodeKey}`)
    return
  }

  const fromNode = result.from.node
  const toNode = result.to.node

  if (options.out && options.out.length > 0) {
    const sinks = options.out.map(parseOutputSpec)
    const sub = result.path
      ? await subgraphFromPath(profile.graph, fromNode.nodeKey, toNode.nodeKey, result.path)
      : { rootKeys: [fromNode.nodeKey, toNode.nodeKey], nodes: [fromNode, toNode], edges: [] }
    emitSubgraphOutputs(sinks, sub, `Path from ${fromNode.displayName} to ${toNode.displayName}`)
    return
  }

  if (!result.path) {
    console.log(`No path found from ${fromNode.displayName} to ${toNode.displayName} within the traversal depth limit.`)
    return
  }

  if (result.path.hops.length === 0) {
    console.log(`${fromNode.displayName} is the same node as ${toNode.displayName}.`)
    return
  }

  const segments = [fromNode.displayName]
  for (const hop of result.path.hops) {
    const arrow = hop.reversed ? `<-[${hop.edgeType}]-` : `-[${hop.edgeType}]->`
    segments.push(arrow, hop.displayName)
  }
  console.log(segments.join(' '))
}
