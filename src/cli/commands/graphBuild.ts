import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { buildGraph } from '../../core/graph/build.js'

export async function graphBuildCommand(): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const { nodeCount, edgeCount } = await buildGraph(profile.graph)
  console.log(`Built structural graph: ${nodeCount} nodes, ${edgeCount} edges`)
}
