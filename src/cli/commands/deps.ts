import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { deps, DEPS_EDGE_TYPES } from '../../core/graph/deps.js'
import type { EdgeType } from '../../core/storage/types.js'

export interface DepsCommandOptions {
  reverse?: boolean
  depth?: string
  edgeTypes?: string
}

export async function depsCommand(identifier: string, options: DepsCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const depth = options.depth !== undefined ? parseInt(options.depth, 10) : undefined
  const edgeTypes = options.edgeTypes
    ? options.edgeTypes.split(',').map((s) => s.trim()).filter(Boolean) as EdgeType[]
    : DEPS_EDGE_TYPES

  const result = await deps(profile.graph, identifier, { reverse: options.reverse, depth, edgeTypes })

  if (result.resolved.status === 'not-found') {
    console.log(`No graph node found for "${identifier}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.`)
    return
  }
  if (result.resolved.status === 'ambiguous') {
    console.log(`"${identifier}" is ambiguous — matches multiple symbols:`)
    for (const c of result.resolved.candidates) console.log(`  ${c.nodeKey}`)
    return
  }

  const node = result.resolved.node
  const label = options.reverse ? 'Dependents of' : 'Dependencies of'
  console.log(`${label} ${node.displayName} (${node.nodeKey}):\n`)

  if (result.hits.length === 0) {
    console.log('  (none)')
    return
  }
  for (const hit of result.hits) {
    console.log(`  [${hit.edgeType}] ${hit.displayName}  (depth ${hit.depth})`)
  }
}
