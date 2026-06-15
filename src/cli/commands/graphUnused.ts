import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { unused } from '../../core/graph/unused.js'
import type { EdgeType } from '../../core/storage/types.js'

export interface GraphUnusedCommandOptions {
  edgeTypes?: string
}

export async function unusedCommand(options: GraphUnusedCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const edgeTypes = options.edgeTypes
    ? options.edgeTypes.split(',').map((s) => s.trim()).filter(Boolean) as EdgeType[]
    : undefined

  const result = await unused(profile.graph, { edgeTypes })

  if (result.nodes.length === 0) {
    console.log('No unused symbols or files found (or `gitsema graph build` has not been run).')
    return
  }

  console.log(`${result.nodes.length} unused node${result.nodes.length === 1 ? '' : 's'} (no inbound calls/imports):\n`)
  for (const node of result.nodes) {
    console.log(`  [${node.kind}] ${node.displayName}${node.path ? `  (${node.path})` : ''}`)
  }
}
