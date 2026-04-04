import { writeFileSync } from 'node:fs'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import {
  computeConceptChangePoints,
  type ConceptChangePointReport,
  type ConceptChangePoint,
} from '../../core/search/changePoints.js'
import { resolveRefToTimestamp } from '../../core/search/clustering.js'

export interface ChangePointsCommandOptions {
  top?: string
  threshold?: string
  topPoints?: string
  since?: string
  until?: string
  dump?: string | boolean
  includeContent?: boolean
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

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProviderOrExit(providerType, model)

  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedQuery(provider, query.trim())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
    throw err
  }

  try {
    const report = computeConceptChangePoints(query.trim(), queryEmbedding, {
      topK,
      threshold,
      topPoints,
      since,
      until,
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

    console.log(`Concept change points: "${query}"`)
    console.log(renderReport(report))
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
