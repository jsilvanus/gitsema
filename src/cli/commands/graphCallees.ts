import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { callees } from '../../core/graph/traversal.js'

export interface GraphCalleesCommandOptions {
  depth?: string
}

export async function graphCalleesCommand(symbol: string, options: GraphCalleesCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const depth = options.depth !== undefined ? parseInt(options.depth, 10) : undefined

  const result = await callees(profile.graph, symbol, depth)

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
  console.log(`Callees of ${node.displayName} (${node.nodeKey}):\n`)

  if (result.hits.length === 0) {
    console.log('  (none)')
    return
  }
  for (const hit of result.hits) {
    console.log(`  ${hit.displayName}  (depth ${hit.depth})`)
  }
}
