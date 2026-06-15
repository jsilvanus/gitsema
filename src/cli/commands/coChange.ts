import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { coChange } from '../../core/graph/coChange.js'

export interface CoChangeCommandOptions {
  top?: string
}

export async function coChangeCommand(path: string, options: CoChangeCommandOptions = {}): Promise<void> {
  const top = options.top !== undefined ? parseInt(options.top, 10) : 10
  const profile = getCachedStorageProfile(process.cwd())
  const result = await coChange(profile.graph, path, top)

  if (!result.found) {
    console.log(`No graph node for "${path}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.`)
    return
  }

  if (result.hits.length === 0) {
    console.log(`No co-change history for ${path}.`)
    return
  }

  console.log(`Files that change together with ${path}:\n`)
  for (const hit of result.hits) {
    console.log(`  ${hit.path}  (${hit.count} commits)`)
  }
}
