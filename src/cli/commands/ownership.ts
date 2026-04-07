import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { computeOwnershipHeatmap } from '../../core/search/ownershipHeatmap.js'
import { parsePositiveInt } from '../../utils/parse.js'

export interface OwnershipOptions {
  top?: string
  window?: string
  dump?: string | boolean
}

export async function ownershipCommand(query: string, options: OwnershipOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query is required')
    process.exit(1)
  }

  const top = options.top ? parsePositiveInt(options.top, '--top') : 5
  const windowDays = options.window ? parsePositiveInt(options.window, '--window') : 90

  applyModelOverrides({})
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  let provider
  try { provider = buildProvider(providerType, model) } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  let emb
  try { emb = await embedQuery(provider!, query) } catch (err) {
    console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  try {
    const heatmap = computeOwnershipHeatmap({ embedding: emb as any, topK: top, windowDays })
    if (options.dump !== undefined) {
      const json = JSON.stringify(heatmap, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Ownership heatmap JSON written to: ${options.dump}`)
      } else {
        process.stdout.write(json + '\n')
      }
      return
    }
    // Default: print simple table
    for (const e of heatmap) {
      console.log(`${e.authorName} <${e.authorEmail}>  score=${e.ownershipScore.toFixed(2)}  total=${e.totalBlobs} recent=${e.recentBlobs} trend=${e.trend}`)
      for (const p of e.topPaths) console.log(`   ${p}`)
    }
  } catch (err) {
    console.error(`Error computing ownership heatmap: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
