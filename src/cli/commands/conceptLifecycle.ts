import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { Embedding } from '../../core/models/types.js'
import { computeConceptLifecycle, type ConceptLifecycleResult } from '../../core/search/conceptLifecycle.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { narrateLifecycle } from '../../core/llm/narrator.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface ConceptLifecycleCommandOptions {
  steps?: string
  threshold?: string
  dump?: string | boolean
  model?: string
  textModel?: string
  codeModel?: string
  narrate?: boolean
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

const STAGE_ICON: Record<string, string> = {
  born: '🌱',
  growing: '📈',
  mature: '🏆',
  declining: '📉',
  dead: '💀',
  unknown: '❓',
}

function renderLifecycle(result: ConceptLifecycleResult): string {
  const lines: string[] = []
  lines.push(`Concept lifecycle: "${result.query}"`)
  lines.push(`  Current stage: ${STAGE_ICON[result.currentStage] ?? ''} ${result.currentStage}`)
  if (result.bornTimestamp) {
    lines.push(`  Born: ${new Date(result.bornTimestamp * 1000).toISOString().slice(0, 10)}`)
  }
  lines.push(`  Peak: ${result.peakCount} matches on ${new Date(result.peakTimestamp * 1000).toISOString().slice(0, 10)}`)
  if (result.isDead) lines.push('  ⚠ Concept appears to be dead (no recent matches)')
  lines.push('')
  lines.push('Timeline:')
  const maxCount = result.peakCount > 0 ? result.peakCount : 1
  for (const p of result.points) {
    const bar = '█'.repeat(Math.round((p.matchCount / maxCount) * 20))
    const icon = STAGE_ICON[p.stage] ?? ' '
    lines.push(`  ${p.date}  ${String(p.matchCount).padStart(4)}  ${bar.padEnd(20)}  ${icon} ${p.stage}`)
  }
  return lines.join('\n')
}

export async function conceptLifecycleCommand(query: string, options: ConceptLifecycleCommandOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query argument is required')
    process.exit(1)
  }

  const steps = options.steps !== undefined ? parseInt(options.steps, 10) : 10
  const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.7

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

  let result: ConceptLifecycleResult
  try {
    result = computeConceptLifecycle(queryEmbedding, query, { steps, threshold })
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
      console.log(`Lifecycle result written to: ${jsonSink.file}`)
    } else {
      process.stdout.write(json + '\n')
      return
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  console.log(renderLifecycle(result))

  if (options.narrate) {
    console.log('')
    console.log('=== LLM Lifecycle Narrative ===')
    const narrative = await narrateLifecycle(result)
    console.log(narrative)
  }
}
