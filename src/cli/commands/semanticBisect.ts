import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { Embedding } from '../../core/models/types.js'
import { computeSemanticBisect, type BisectResult } from '../../core/search/semanticBisect.js'
import { formatDate } from '../../core/search/ranking.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'

export interface SemanticBisectCommandOptions {
  top?: string
  maxSteps?: string
  dump?: string | boolean
  model?: string
  textModel?: string
  codeModel?: string
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

function renderBisectResult(result: BisectResult): string {
  const lines: string[] = []
  lines.push(`Semantic bisect: "${result.query}"`)
  lines.push(`  good: ${result.goodRef}  →  bad: ${result.badRef}`)
  lines.push(`  Culprit: ${result.culpritRef}  (max shift ${result.maxShift.toFixed(3)})`)
  lines.push('')
  lines.push('Steps:')
  for (const step of result.steps) {
    const dist = step.distanceFromGood.toFixed(3)
    const date = new Date(step.timestamp * 1000).toISOString().slice(0, 10)
    const flag = step.distanceFromGood > 0.1 ? '⚠' : '✓'
    lines.push(`  ${flag}  ${date}  blobs=${step.blobCount}  dist=${dist}`)
  }
  return lines.join('\n')
}

export async function semanticBisectCommand(
  goodRef: string,
  badRef: string,
  query: string,
  options: SemanticBisectCommandOptions,
): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query argument is required')
    process.exit(1)
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 20
  const maxSteps = options.maxSteps !== undefined ? parseInt(options.maxSteps, 10) : 10

  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProviderOrExit(providerType, model)

  let queryEmbedding: Embedding
  try {
    queryEmbedding = await embedQuery(provider, query)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
    throw err
  }

  let result: BisectResult
  try {
    result = computeSemanticBisect(queryEmbedding, query, goodRef, badRef, { topK, maxSteps })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    process.exit(1)
    throw err
  }

  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: undefined })
  const jsonSink = getSink(sinks, 'json')

  if (jsonSink) {
    const json = JSON.stringify(result, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Bisect result written to: ${jsonSink.file}`)
    } else {
      process.stdout.write(json + '\n')
      return
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  console.log(renderBisectResult(result))
}
