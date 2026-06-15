import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { path } from '../../core/graph/traversal.js'

export async function graphPathCommand(a: string, b: string): Promise<void> {
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
