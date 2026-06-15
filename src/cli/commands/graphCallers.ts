import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { callers } from '../../core/graph/traversal.js'

export interface GraphCallersCommandOptions {
  depth?: string
}

export async function graphCallersCommand(symbol: string, options: GraphCallersCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const depth = options.depth !== undefined ? parseInt(options.depth, 10) : undefined

  const result = await callers(profile.graph, symbol, depth)

  if (result.resolved.status === 'not-found') {
    console.log(`No graph node found for "${symbol}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.`)
    return
  }
  if (result.resolved.status === 'ambiguous') {
    console.log(`"${symbol}" is ambiguous — matches multiple symbols:`)
    for (const c of result.resolved.candidates) console.log(`  ${c.nodeKey}`)
    return
  }

  const node = result.resolved.node
  console.log(`Callers of ${node.displayName} (${node.nodeKey}):\n`)

  if (result.hits.length === 0) {
    console.log('  (none)')
    return
  }
  for (const hit of result.hits) {
    console.log(`  ${hit.displayName}  (depth ${hit.depth})`)
  }
}
