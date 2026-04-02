import { writeFileSync } from 'node:fs'
import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { computeConceptEvolution } from '../../core/search/evolution.js'
import { formatDate, shortHash } from '../../core/search/ranking.js'
import { getBlobContent } from '../../core/indexing/blobStore.js'
import type { ConceptEvolutionEntry } from '../../core/search/evolution.js'
import { remoteConceptEvolution } from '../../client/remoteClient.js'
import { renderConceptEvolutionHtml } from '../../core/viz/htmlRenderer.js'

export interface ConceptEvolutionCommandOptions {
  top?: string
  threshold?: string
  dump?: string | boolean
  html?: string | boolean
  includeContent?: boolean
  remote?: string
}

function buildProvider(providerType: string, model: string): EmbeddingProvider {
  if (providerType === 'http') {
    const baseUrl = process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      console.error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
      process.exit(1)
    }
    return new HttpProvider({ baseUrl, model, apiKey: process.env.GITSEMA_API_KEY })
  }
  return new OllamaProvider({ model })
}

/**
 * Renders a human-readable concept evolution timeline.
 *
 * Example output:
 *   2021-03-15  src/auth/session.ts         [a3f9c2d]  score=0.892  dist_prev=0.000  (origin)
 *   2021-06-22  src/auth/oauth.ts           [b19e4a1]  score=0.912  dist_prev=0.145
 *   2022-09-10  src/auth/jwt.ts             [c02d8f7]  score=0.872  dist_prev=0.231  ← large change
 */
function renderConceptEvolution(entries: ConceptEvolutionEntry[], threshold: number): string {
  if (entries.length === 0) return '  (no matching blobs found — has the index been built?)'

  return entries
    .map((e, i) => {
      const date = formatDate(e.timestamp)
      const path = (e.paths[0] ?? '(unknown path)').padEnd(50)
      const blob = shortHash(e.blobHash)
      const score = e.score.toFixed(3)
      const dPrev = e.distFromPrev.toFixed(4)
      let note = ''
      if (i === 0) note = '  (origin)'
      else if (e.distFromPrev >= threshold) note = '  ← large change'
      return `${date}  ${path}  [${blob}]  score=${score}  dist_prev=${dPrev}${note}`
    })
    .join('\n')
}

/**
 * Serializes concept evolution entries as structured JSON suitable for
 * agent consumption.
 */
function serializeConceptEvolutionJson(
  query: string,
  entries: ConceptEvolutionEntry[],
  threshold: number,
  includeContent: boolean,
): string {
  const data = {
    query,
    entries: entries.length,
    threshold,
    timeline: entries.map((e, i) => {
      const item: Record<string, unknown> = {
        index: i,
        date: formatDate(e.timestamp),
        timestamp: e.timestamp,
        blobHash: e.blobHash,
        commitHash: e.commitHash,
        paths: e.paths,
        score: e.score,
        distFromPrev: e.distFromPrev,
        isOrigin: i === 0,
        isLargeChange: i > 0 && e.distFromPrev >= threshold,
      }
      if (includeContent) {
        item.content = getBlobContent(e.blobHash) ?? null
      }
      return item
    }),
    summary: {
      largeChanges: entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length,
      maxDistFromPrev:
        entries.length > 0 ? Math.max(...entries.map((e) => e.distFromPrev), 0) : 0,
      avgScore:
        entries.length > 0
          ? entries.reduce((sum, e) => sum + e.score, 0) / entries.length
          : 0,
    },
  }
  return JSON.stringify(data, null, 2)
}

export async function conceptEvolutionCommand(
  query: string,
  options: ConceptEvolutionCommandOptions,
): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query string is required')
    process.exit(1)
  }

  const remoteUrl = options.remote ?? process.env.GITSEMA_REMOTE
  if (remoteUrl) {
    process.env.GITSEMA_REMOTE = remoteUrl
    const top = options.top !== undefined ? parseInt(options.top, 10) : 50
    const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.3
    try {
      const result = await remoteConceptEvolution(query.trim(), {
        top,
        threshold,
        includeContent: options.includeContent ?? false,
      })
      const json = JSON.stringify(result, null, 2)
      if (options.dump !== undefined) {
        if (typeof options.dump === 'string') {
          writeFileSync(options.dump, json, 'utf8')
          console.log(`Concept evolution JSON written to: ${options.dump}`)
        } else {
          process.stdout.write(json + '\n')
          return
        }
      }
      // Human-readable summary from structured data
      const data = result as { query: string; entries: number; timeline: Array<{ date: string; blobHash: string; paths: string[]; score: number; distFromPrev: number; isOrigin: boolean; isLargeChange: boolean }> }
      console.log(`Concept evolution: "${data.query}"`)
      console.log(`Entries found: ${data.entries}`)
      if (data.timeline.length > 0) {
        console.log('')
        for (const e of data.timeline) {
          const path = (e.paths[0] ?? '(unknown path)').padEnd(50)
          const note = e.isOrigin ? '  (origin)' : e.isLargeChange ? '  ← large change' : ''
          console.log(`${e.date}  ${path}  [${e.blobHash.slice(0, 7)}]  score=${e.score.toFixed(3)}  dist_prev=${e.distFromPrev.toFixed(4)}${note}`)
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
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

  const includeContent = options.includeContent ?? false

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model =
    process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProvider(providerType, model)

  let queryEmbedding: number[]
  try {
    queryEmbedding = await provider.embed(query.trim())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
  }

  const entries = computeConceptEvolution(queryEmbedding, topK)

  // --dump: emit structured JSON to a file or stdout
  if (options.dump !== undefined) {
    const json = serializeConceptEvolutionJson(query.trim(), entries, threshold, includeContent)

    if (typeof options.dump === 'string') {
      // --dump <file> → write JSON to file, then print human-readable to stdout
      try {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Concept evolution JSON written to: ${options.dump}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error writing dump file: ${msg}`)
        process.exit(1)
      }
      // Fall through to also print human-readable summary below
    } else {
      // --dump without a file path → print JSON to stdout and exit
      process.stdout.write(json + '\n')
      return
    }
  }

  // --html: emit interactive HTML visualization
  if (options.html !== undefined) {
    const html = renderConceptEvolutionHtml(query.trim(), entries, threshold)
    const outFile = typeof options.html === 'string' ? options.html : 'concept-evolution.html'
    try {
      writeFileSync(outFile, html, 'utf8')
      console.log(`Concept evolution HTML written to: ${outFile}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error writing HTML file: ${msg}`)
      process.exit(1)
    }
    return
  }

  // Human-readable output
  console.log(`Concept evolution: "${query}"`)
  console.log(`Entries found: ${entries.length}`)
  if (entries.length > 0) {
    console.log('')
    console.log(renderConceptEvolution(entries, threshold))
  }
}
