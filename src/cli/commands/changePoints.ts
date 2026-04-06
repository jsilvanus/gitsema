import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import {
  computeConceptChangePoints,
  type ConceptChangePointReport,
  type ConceptChangePoint,
} from '../../core/search/changePoints.js'
import { resolveRefToTimestamp } from '../../core/search/clustering.js'
import { renderConceptChangePointsHtml } from '../../core/viz/htmlRenderer.js'
import { hybridSearch } from '../../core/search/hybridSearch.js'
import { narrateChangePoints } from '../../core/llm/narrator.js'

export interface ChangePointsCommandOptions {
  top?: string
  threshold?: string
  topPoints?: string
  since?: string
  until?: string
  dump?: string | boolean
  html?: string | boolean
  includeContent?: boolean
  branch?: string
  model?: string
  textModel?: string
  codeModel?: string
  hybrid?: boolean
  bm25Weight?: string
  narrate?: boolean
  noHeadings?: boolean
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

function renderChangePoint(point: ConceptChangePoint, rank: number): string {
  const lines: string[] = []
  lines.push(
    `  #${rank}  ${point.before.date} → ${point.after.date}  distance=${point.distance.toFixed(4)}`,
  )
  lines.push(
    `       before: [${point.before.commit.slice(0, 7)}]  paths: ${point.before.topPaths.slice(0, 3).join(', ') || '(none)'}`,
  )
  lines.push(
    `       after:  [${point.after.commit.slice(0, 7)}]  paths: ${point.after.topPaths.slice(0, 3).join(', ') || '(none)'}`,
  )
  return lines.join('\n')
}

function renderReport(report: ConceptChangePointReport): string {
  const lines: string[] = []

  if (report.range.since || report.range.until) {
    const sinceStr = report.range.since ?? '(earliest)'
    const untilStr = report.range.until ?? '(latest)'
    lines.push(`Range: ${sinceStr} → ${untilStr}`)
  }
  lines.push(`k=${report.k}  threshold=${report.threshold}`)
  lines.push('')

  if (report.points.length === 0) {
    lines.push(`  (no change points found above threshold ${report.threshold})`)
    return lines.join('\n')
  }

  lines.push(`Top ${report.points.length} change point(s):`)
  lines.push('')
  for (let i = 0; i < report.points.length; i++) {
    lines.push(renderChangePoint(report.points[i], i + 1))
    lines.push('')
  }
  return lines.join('\n')
}

export async function changePointsCommand(
  query: string,
  options: ChangePointsCommandOptions,
): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query string is required')
    process.exit(1)
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 50
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.3
  if (isNaN(threshold) || threshold < 0 || threshold > 2) {
    console.error('Error: --threshold must be a number between 0 and 2')
    process.exit(1)
  }

  const topPoints = options.topPoints !== undefined ? parseInt(options.topPoints, 10) : 5
  if (isNaN(topPoints) || topPoints < 1) {
    console.error('Error: --top-points must be a positive integer')
    process.exit(1)
  }

  let since: number | undefined
  let until: number | undefined

  if (options.since !== undefined) {
    try {
      since = resolveRefToTimestamp(options.since)
    } catch {
      console.error(`Error: cannot resolve --since "${options.since}" to a timestamp.`)
      process.exit(1)
    }
  }
  if (options.until !== undefined) {
    try {
      until = resolveRefToTimestamp(options.until)
    } catch {
      console.error(`Error: cannot resolve --until "${options.until}" to a timestamp.`)
      process.exit(1)
    }
  }

  // Apply CLI model overrides
  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProviderOrExit(providerType, model)

  let queryEmbedding: Embedding
  try {
    queryEmbedding = await embedQuery(provider, query.trim())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
    throw err
  }

  // When --hybrid is set, use hybrid search to get candidate blobs
  let candidateHashes: string[] | undefined
  if (options.hybrid) {
    const bw = options.bm25Weight !== undefined ? parseFloat(options.bm25Weight) : 0.3
    const hybridResults = hybridSearch(query.trim(), queryEmbedding, { topK: topK, bm25Weight: bw, branch: options.branch })
    candidateHashes = hybridResults.map((r) => r.blobHash)
  }

  try {
    const report = computeConceptChangePoints(query.trim(), queryEmbedding, {
      topK,
      threshold,
      topPoints,
      since,
      until,
      branch: options.branch,
      candidateHashes,
    })

    if (options.dump !== undefined) {
      const json = JSON.stringify(report, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Change points JSON written to: ${options.dump}`)
      } else {
        process.stdout.write(json + '\n')
        return
      }
    }

    if (options.html !== undefined) {
      const html = renderConceptChangePointsHtml(report)
      const outFile = typeof options.html === 'string' ? options.html : 'change-points.html'
      writeFileSync(outFile, html, 'utf8')
      console.log(`Change points HTML written to: ${outFile}`)
      return
    }

    if (!options.noHeadings) console.log(`Concept change points: "${query}"`)
    console.log(renderReport(report))

    if (options.narrate && report.points.length > 0) {
      console.log('')
      console.log('=== LLM Change-Points Narrative ===')
      const narrative = await narrateChangePoints(report)
      console.log(narrative)
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
