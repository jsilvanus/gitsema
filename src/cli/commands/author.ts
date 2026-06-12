import { writeFileSync } from 'node:fs'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { Embedding } from '../../core/models/types.js'
import { computeAuthorContributions, type AuthorContribution } from '../../core/search/authorSearch.js'
import { hybridSearch } from '../../core/search/analysis/hybridSearch.js'
import { parseDateArg } from '../../core/search/temporal/timeSearch.js'
import { logger } from '../../utils/logger.js'
import { searchCommits, type CommitSearchResult } from '../../core/search/commitSearch.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'
import { buildProviderOrExit, resolveModels } from '../lib/provider.js'
import { emitJsonSink } from '../lib/output.js'

export interface AuthorCommandOptions {
  top?: string
  since?: string
  detail?: boolean
  dump?: string | boolean
  branch?: string
  hybrid?: boolean
  bm25Weight?: string
  model?: string
  textModel?: string
  codeModel?: string
  includeCommits?: boolean
  chunks?: boolean
  level?: string
  vss?: boolean
  html?: string | boolean
  noHeadings?: boolean
  out?: string[]
}

export async function authorCommand(query: string, options: AuthorCommandOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query string is required')
    process.exit(1)
  }

  const topAuthors = options.top !== undefined ? parseInt(options.top, 10) : 10
  const detail = options.detail ?? false
  const useHybrid = options.hybrid ?? false
  const bm25Weight = options.bm25Weight !== undefined ? parseFloat(options.bm25Weight) : 0.3

  let since: number | undefined
  if (options.since) {
    try {
      since = parseDateArg(options.since)
    } catch (err) {
      console.error(`Invalid --since value: ${options.since}`)
      process.exit(1)
    }
  }

  // Apply CLI model overrides
  const { providerType, textModel } = resolveModels({
    model: options.model,
    textModel: options.textModel,
    codeModel: options.codeModel,
  })
  const provider = buildProviderOrExit(providerType, textModel)

  let queryEmbedding: Embedding
  try {
    queryEmbedding = await embedQuery(provider, query)
  } catch (err) {
    logger.error('Failed to embed query')
    console.error('Failed to embed query. Is the embedding provider running?')
    process.exit(1)
    throw err
  }

  // When --hybrid is set, use hybrid search to get pre-scored candidates
  let candidateBlobs: Array<{ blobHash: string; score: number }> | undefined
  if (useHybrid) {
    const hybridResults = hybridSearch(query.trim(), queryEmbedding, {
      topK: 50,
      bm25Weight,
      branch: options.branch,
    })
    candidateBlobs = hybridResults.map((r) => ({ blobHash: r.blobHash, score: r.score }))
  }

  const results = await computeAuthorContributions(queryEmbedding, {
    topK: 50,
    topAuthors,
    since,
    detail,
    branch: options.branch,
    candidateBlobs,
  })

  // Optionally include commit search results
  let commitResults: CommitSearchResult[] | undefined
  if (options.includeCommits) {
    commitResults = searchCommits(queryEmbedding, { topK: 50, model: textModel })
  }

  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: options.html })
  const jsonSink = getSink(sinks, 'json')
  const htmlSink = getSink(sinks, 'html')

  const outObj: any = { authors: results }
  if (commitResults) outObj.commits = commitResults

  if (emitJsonSink({
    sinks,
    jsonSink,
    payload: outObj,
    fileMessage: (file) => `Author attribution written to ${file}`,
    htmlAware: true,
  }).handled) return

  if (htmlSink) {
    const { renderAuthorHtml } = await import('../../core/viz/htmlRenderer.js')
    const html = renderAuthorHtml(results, query)
    if (htmlSink.file) {
      writeFileSync(htmlSink.file, html, 'utf8')
      console.log(`Author HTML written to: ${htmlSink.file}`)
    } else {
      process.stdout.write(html + '\n')
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  if (results.length === 0 && !commitResults) {
    console.log(`No author contributions found for: "${query}"`)
    return
  }

  // vss flag note
  if (options.vss) {
    console.warn('Note: --vss flag is not applicable to author attribution and will be ignored.')
  }

  if (!options.noHeadings) console.log(`\nAuthor contributions for: "${query}"\n`)
  results.forEach((author: AuthorContribution, idx: number) => {
    const rank = idx + 1
    const scoreStr = author.totalScore.toFixed(3)
    const emailPart = author.authorEmail ? ` <${author.authorEmail}>` : ''
    console.log(`${rank}. ${author.authorName}${emailPart}`)
    console.log(`   Score: ${scoreStr}  |  Blobs: ${author.blobCount}`)

    if (detail && author.blobs.length > 0) {
      const byPath = new Map<string, { score: number; count: number }>()
      for (const blob of author.blobs) {
        for (const p of blob.paths.length > 0 ? blob.paths : ['(unknown)']) {
          const existing = byPath.get(p) ?? { score: 0, count: 0 }
          existing.score += blob.score
          existing.count++
          byPath.set(p, existing)
        }
      }
      const pathEntries = Array.from(byPath.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 5)
      for (const [p, info] of pathEntries) {
        console.log(`   · ${p} (${info.count} blob${info.count !== 1 ? 's' : ''}, score: ${info.score.toFixed(3)})`)
      }
    }
    console.log()
  })
}
