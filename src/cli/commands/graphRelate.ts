import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { relate } from '../../core/graph/relate.js'
import { parseLens } from '../lib/lens.js'
import { renderResolutionError } from '../lib/graphRender.js'

export interface GraphRelateCommandOptions {
  top?: string
  lens?: string
}

export async function relateCommand(symbol: string, options: GraphRelateCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const topK = options.top !== undefined ? parseInt(options.top, 10) : undefined
  const lens = parseLens(options.lens, 'hybrid')

  const result = await relate(profile.graph, symbol, { topK, lens })

  if (result.resolved.status !== 'found') {
    console.log(renderResolutionError(symbol, result.resolved))
    return
  }

  const node = result.resolved.node
  console.log(`Related to ${node.displayName} (${node.nodeKey}) — lens: ${result.lens}\n`)

  if (result.lens !== 'semantic') {
    console.log('Called by [structural]:')
    if (result.callers.length === 0) {
      console.log('  (none)')
    } else {
      for (const hit of result.callers) console.log(`  ${hit.displayName}`)
    }
    console.log('')

    console.log('Calls [structural]:')
    if (result.callees.length === 0) {
      console.log('  (none)')
    } else {
      for (const hit of result.callees) console.log(`  ${hit.displayName}`)
    }
    console.log('')
  }

  if (result.lens !== 'structural') {
    console.log('Semantically similar [semantic]:')
    if (!result.semanticSupported) {
      console.log('  (not supported on this storage backend)')
    } else if (result.similar.length === 0) {
      console.log('  (none)')
    } else {
      for (const hit of result.similar) {
        const label = hit.symbolName ?? hit.paths[0] ?? '(unknown)'
        console.log(`  ${hit.score.toFixed(3)}  ${label}`)
      }
    }
  }
}
