import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { blastRadius } from '../../core/graph/blastRadius.js'
import { subgraphFromHits } from '../../core/graph/subgraphView.js'
import { parseLens } from '../lib/lens.js'
import { renderResolutionError, renderBlastRadius } from '../lib/graphRender.js'
import { parseOutputSpec } from '../../utils/outputSink.js'
import { emitSubgraphOutputs } from '../lib/graphOutput.js'

export interface GraphBlastRadiusCommandOptions {
  lens?: string
  depth?: string
  top?: string
  out?: string[]
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

  if (options.out && options.out.length > 0) {
    const sinks = options.out.map(parseOutputSpec)
    const sub = await subgraphFromHits(profile.graph, result.resolved.node.nodeKey, result.structural, 'in')
    emitSubgraphOutputs(sinks, sub, `Blast radius of ${result.resolved.node.displayName}`)
    return
  }

  console.log(renderBlastRadius(result, result.resolved.node))
}
