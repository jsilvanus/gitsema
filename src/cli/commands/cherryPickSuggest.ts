import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { suggestCherryPicks } from '../../core/search/cherryPick.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'
import { formatScore } from '../../core/search/ranking.js'
import type { Embedding } from '../../core/models/types.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'

export interface CherryPickOptions {
  top?: string
  model?: string
  dump?: string | boolean
  out?: string[]
}

function buildProviderOrExit(providerType: string, model: string): EmbeddingProvider {
  try {
    return buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
  }
}

export async function cherryPickSuggestCommand(query: string, options: CherryPickOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query is required')
    process.exit(1)
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 10
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  applyModelOverrides({ model: options.model })
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProviderOrExit(providerType, textModel)

  let qEmb: Embedding
  try {
    qEmb = await embedQuery(provider, query)
  } catch (err) {
    console.error(`Failed to embed query: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
  }

  const results = suggestCherryPicks(qEmb, { topK, model: textModel })

  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: undefined })
  const jsonSink = getSink(sinks, 'json')

  if (jsonSink) {
    const json = JSON.stringify(results, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Wrote cherry-pick suggestions to ${jsonSink.file}`)
    } else {
      process.stdout.write(json + '\n')
      return
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  if (results.length === 0) {
    console.log('No cherry-pick suggestions found.')
    return
  }

  console.log(`Cherry-pick suggestions for: "${query}"\n`)
  results.forEach((r, idx) => {
    console.log(`${idx + 1}. ${formatScore(r.score)}  ${r.commitHash.slice(0, 7)}  ${r.message}`)
  })
}
