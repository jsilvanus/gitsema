import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { blastRadius } from '../../core/graph/blastRadius.js'
import { parseLens } from '../lib/lens.js'
import { renderResolutionError, renderBlastRadius } from '../lib/graphRender.js'

export interface GraphBlastRadiusCommandOptions {
  lens?: string
  depth?: string
  top?: string
}

export async function blastRadiusCommand(symbol: string, options: GraphBlastRadiusCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const lens = parseLens(options.lens, 'hybrid')
  const depth = options.depth !== undefined ? parseInt(options.depth, 10) : undefined
  const topK = options.top !== undefined ? parseInt(options.top, 10) : undefined

  const result = await blastRadius(profile.graph, symbol, { lens, depth, topK })

  if (result.resolved.status !== 'found') {
    console.log(renderResolutionError(symbol, result.resolved))
    return
  }

  console.log(renderBlastRadius(result, result.resolved.node))
}
