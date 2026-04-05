import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import { computeSemanticDiff } from '../../core/search/semanticDiff.js'
import { formatDate, shortHash } from '../../core/search/ranking.js'
import { renderSemanticDiffHtml } from '../../core/viz/htmlRenderer.js'
import type { SemanticDiffEntry, SemanticDiffResult } from '../../core/search/semanticDiff.js'

export interface SemanticDiffCommandOptions {
  top?: string
  dump?: string | boolean
  html?: string | boolean
  // CLI model overrides
  model?: string
  textModel?: string
  codeModel?: string
  hybrid?: boolean
  bm25Weight?: string
  branch?: string
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

function renderGroup(label: string, entries: SemanticDiffEntry[]): string {
  if (entries.length === 0) return `  ${label}: (none)`
  const maxPathLen = Math.max(30, ...entries.map((e) => (e.paths[0] ?? '').length))
  const lines = [`  ${label}:`]
  for (const e of entries) {
    const path = (e.paths[0] ?? '(unknown path)').padEnd(maxPathLen)
    const blob = shortHash(e.blobHash)
    const score = e.score.toFixed(3)
    const date = formatDate(e.firstSeen)
    lines.push(`    ${date}  ${path}  [${blob}]  score=${score}`)
  }
  return lines.join('\n')
}

function renderSemanticDiff(result: SemanticDiffResult): string {
  const lines: string[] = []
  lines.push(`Semantic diff: "${result.topic}"`)
  lines.push(`  ref1: ${result.ref1}  (${formatDate(result.timestamp1)})`)
  lines.push(`  ref2: ${result.ref2}  (${formatDate(result.timestamp2)})`)
  lines.push('')
  lines.push(renderGroup('Gained (new in ref2)', result.gained))
  lines.push('')
  lines.push(renderGroup('Lost (removed from ref1)', result.lost))
  lines.push('')
  lines.push(renderGroup('Stable (present in both)', result.stable))
  return lines.join('\n')
}

function serializeSemanticDiffJson(result: SemanticDiffResult): string {
  const serializeEntry = (e: SemanticDiffEntry) => ({
    blobHash: e.blobHash,
    paths: e.paths,
    score: e.score,
    firstSeen: e.firstSeen,
    date: formatDate(e.firstSeen),
  })
  const data = {
    topic: result.topic,
    ref1: result.ref1,
    ref2: result.ref2,
    timestamp1: result.timestamp1,
    timestamp2: result.timestamp2,
    gained: result.gained.map(serializeEntry),
    lost: result.lost.map(serializeEntry),
    stable: result.stable.map(serializeEntry),
    summary: {
      gained: result.gained.length,
      lost: result.lost.length,
      stable: result.stable.length,
    },
  }
  return JSON.stringify(data, null, 2)
}

export async function semanticDiffCommand(
  ref1: string,
  ref2: string,
  query: string,
  options: SemanticDiffCommandOptions,
): Promise<void> {
  const topic = query?.trim() ?? ''
  if (!topic) {
    console.error('Error: query argument is required')
    process.exit(1)
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 10
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  // Apply CLI model overrides
  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model =
    process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProviderOrExit(providerType, model)

  let queryEmbedding: Embedding
  try {
    queryEmbedding = await embedQuery(provider, topic)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
    throw err
  }

  let result: SemanticDiffResult
  try {
    result = computeSemanticDiff(queryEmbedding, topic, ref1, ref2, topK, options.branch)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    process.exit(1)
    throw err
  }

  if (options.html !== undefined) {
    const html = renderSemanticDiffHtml(result)
    const outFile = typeof options.html === 'string' ? options.html : 'semantic-diff.html'
    try {
      writeFileSync(outFile, html, 'utf8')
      console.log(`Semantic diff HTML written to: ${outFile}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error writing HTML file: ${msg}`)
      process.exit(1)
    }
    return
  }

  if (options.dump !== undefined) {
    const json = serializeSemanticDiffJson(result)
    if (typeof options.dump === 'string') {
      try {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Semantic diff JSON written to: ${options.dump}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error writing dump file: ${msg}`)
        process.exit(1)
      }
    } else {
      process.stdout.write(json + '\n')
      return
    }
  }

  console.log(renderSemanticDiff(result))
}
