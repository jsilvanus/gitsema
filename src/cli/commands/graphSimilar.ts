import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { similar } from '../../core/graph/similar.js'
import { parseLens } from '../lib/lens.js'
import { renderResolutionError } from '../lib/graphRender.js'

export interface GraphSimilarCommandOptions {
  lens?: string
  top?: string
}

export async function similarCommand(symbol: string, options: GraphSimilarCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const lens = parseLens(options.lens, 'hybrid')
  const topK = options.top !== undefined ? parseInt(options.top, 10) : undefined

  const result = await similar(profile.graph, symbol, { lens, topK })

  if (result.resolved.status !== 'found') {
    console.log(renderResolutionError(symbol, result.resolved))
    return
  }

  const node = result.resolved.node
  console.log(`Similar to ${node.displayName} (${node.nodeKey}) — lens: ${lens}\n`)

  if (lens !== 'semantic') {
    console.log('Structural (same call/import shape):')
    if (result.structural.length === 0) {
      console.log('  (none)')
    } else {
      for (const hit of result.structural) {
        console.log(`  ${hit.jaccard.toFixed(3)}  ${hit.displayName}  (${hit.shared} shared)`)
      }
    }
    console.log('')
  }

  if (lens !== 'structural') {
    console.log('Semantic:')
    if (!result.semanticSupported) {
      console.log('  (not supported on this storage backend)')
    } else if (result.semantic.length === 0) {
      console.log('  (none)')
    } else {
      for (const hit of result.semantic) {
        const label = hit.symbolName ?? hit.paths[0] ?? '(unknown)'
        console.log(`  ${hit.score.toFixed(3)}  ${label}`)
      }
    }
  }
}
