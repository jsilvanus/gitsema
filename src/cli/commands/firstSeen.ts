import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { hybridSearch } from '../../core/search/hybridSearch.js'
import { searchCommits, type CommitSearchResult } from '../../core/search/commitSearch.js'
import { renderFirstSeenResults, formatDate, shortHash, formatScore } from '../../core/search/ranking.js'
import { remoteFirstSeen } from '../../client/remoteClient.js'

export interface FirstSeenCommandOptions {
  top?: string
  remote?: string
  branch?: string
  hybrid?: boolean
  bm25Weight?: string
  includeCommits?: boolean
  /**
   * When present, write JSON output.  A string value is the output file path;
   * boolean `true` means print JSON to stdout.
   */
  dump?: string | boolean
  // CLI model overrides
  model?: string
  textModel?: string
  codeModel?: string
  vss?: boolean
  html?: string | boolean
  /** Comma-separated repo IDs to search across (multi-repo) */
  repos?: string
}

function renderCommitResults(results: CommitSearchResult[]): string {
  if (results.length === 0) return '  (no commit results)'
  const lines: string[] = []
  // Sort chronologically (oldest-first) to match first-seen intent
  const sorted = [...results].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  for (const result of sorted) {
    const score = formatScore(result.score)
    const hash = shortHash(result.commitHash)
    const date = formatDate(result.timestamp)
    lines.push(`${score}  ${hash}  ${date}  ${result.message}`)
    for (const p of result.paths.slice(0, 5)) {
      lines.push(`       ${p}`)
    }
    if (result.paths.length > 5) {
      lines.push(`       … and ${result.paths.length - 5} more file(s)`)
    }
  }
  return lines.join('\n')
}

export async function firstSeenCommand(query: string, options: FirstSeenCommandOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query string is required')
    process.exit(1)
  }

  const remoteUrl = options.remote ?? process.env.GITSEMA_REMOTE
  if (remoteUrl) {
    process.env.GITSEMA_REMOTE = remoteUrl
    const top = options.top !== undefined ? parseInt(options.top, 10) : 10
    try {
      const results = await remoteFirstSeen(query, top)
      console.log(renderFirstSeenResults(results))
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 10
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  const useHybrid = options.hybrid ?? false
  const bm25Weight = options.bm25Weight !== undefined ? parseFloat(options.bm25Weight) : 0.3

  // Apply CLI model overrides
  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

  let provider: EmbeddingProvider
  try {
    provider = buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
  }

  let queryEmbedding: Embedding
  try {
    queryEmbedding = await embedQuery(provider, query)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
    throw err
  }

  // Get top-k results by semantic similarity; vectorSearch populates firstSeen/firstCommit.
  // renderFirstSeenResults re-sorts by earliest date so the output shows when each
  // concept first appeared in the codebase.
  let results = useHybrid
    ? hybridSearch(query.trim(), queryEmbedding, { topK, bm25Weight, branch: options.branch })
    : vectorSearch(queryEmbedding, { topK, branch: options.branch })

  // --repos: merge results across registered repositories
  if (options.repos) {
    try {
      const { multiRepoSearch } = await import('../../core/indexing/repoRegistry.js')
      const { getActiveSession } = await import('../../core/db/sqlite.js')
      const session = getActiveSession()
      const repoIds = options.repos.split(',').map((s) => s.trim()).filter(Boolean)
      const multiResults = await multiRepoSearch(session, Array.from(queryEmbedding) as number[], {
        repoIds: repoIds.length > 0 ? repoIds : undefined,
        topK,
        model,
      })
      const combined = [...results, ...multiResults]
      combined.sort((a, b) => b.score - a.score)
      results = combined.slice(0, topK)
    } catch (err) {
      console.error(`Warning: multi-repo search failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Optionally include commit-message results (sorted chronologically)
  let commitResults: CommitSearchResult[] | undefined
  if (options.includeCommits) {
    commitResults = searchCommits(queryEmbedding, { topK, model })
  }

  if (options.dump !== undefined) {
    const payload: Record<string, unknown> = { results }
    if (commitResults !== undefined) payload.commits = commitResults
    const json = JSON.stringify(payload, null, 2)
    if (typeof options.dump === 'string') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`First-seen results JSON written to: ${options.dump}`)
    } else {
      process.stdout.write(json + '\n')
    }
    return
  }

  // --html support
  if (options.html !== undefined) {
    const { renderFirstSeenHtml } = await import('../../core/viz/htmlRenderer.js')
    const html = renderFirstSeenHtml(results, query)
    const outFile = typeof options.html === 'string' ? options.html : 'first-seen.html'
    writeFileSync(outFile, html, 'utf8')
    console.log(`First-seen HTML written to: ${outFile}`)
    return
  }

  // --vss note
  if (options.vss) {
    console.warn('Note: --vss option is not implemented for first-seen; falling back to linear scan')
  }

  console.log(renderFirstSeenResults(results))
  if (commitResults !== undefined && commitResults.length > 0) {
    console.log('\nCommit results (chronological):')
    console.log(renderCommitResults(commitResults))
  }
}
