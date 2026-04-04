import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { getCachedQueryEmbedding, setCachedQueryEmbedding } from '../../core/embedding/queryCache.js'
import { vectorSearch, mergeSearchResults } from '../../core/search/vectorSearch.js'
import { hybridSearch } from '../../core/search/hybridSearch.js'
import { renderResults, groupResults, formatScore, formatDate, shortHash, type GroupMode } from '../../core/search/ranking.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { remoteSearch } from '../../client/remoteClient.js'
import { searchCommits, type CommitSearchResult } from '../../core/search/commitSearch.js'

export interface SearchCommandOptions {
  top?: string
  recent?: boolean
  alpha?: string
  before?: string
  after?: string
  weightVector?: string
  weightRecency?: string
  weightPath?: string
  group?: string
  chunks?: boolean
  hybrid?: boolean
  bm25Weight?: string
  remote?: string
  branch?: string
  /**
   * Commander sets this to `false` when the user passes `--no-cache`.
   * Defaults to `true` (use cache). When `false`, skip both cache reads and writes.
   */
  cache?: boolean
  /**
   * When true, also searches commit message embeddings and displays matching
   * commits alongside blob results.
   */
  includeCommits?: boolean
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

async function embedQuery(
  provider: EmbeddingProvider,
  model: string,
  query: string,
  noCache: boolean,
): Promise<number[]> {
  if (!noCache) {
    const cached = getCachedQueryEmbedding(query, model)
    if (cached) return cached
  }
  let embedding: number[]
  try {
    embedding = await provider.embed(query)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query with ${model} — ${msg}`)
    process.exit(1)
  }
  if (!noCache) {
    try {
      setCachedQueryEmbedding(query, model, embedding)
    } catch {
      // Cache write failures are non-fatal
    }
  }
  return embedding
}

/**
 * Renders a list of CommitSearchResults as human-readable CLI output.
 *
 * Example:
 *   0.921  abc1234  2024-03-15  fix authentication token validation
 *            src/auth/jwt.ts
 *            src/auth/session.ts
 */
function renderCommitResults(results: CommitSearchResult[]): string {
  if (results.length === 0) return '  (no commit results)'
  const lines: string[] = []
  for (const result of results) {
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

export async function searchCommand(query: string, options: SearchCommandOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query string is required')
    process.exit(1)
  }

  const remoteUrl = options.remote ?? process.env.GITSEMA_REMOTE
  if (remoteUrl) {
    process.env.GITSEMA_REMOTE = remoteUrl
    const top = options.top !== undefined ? parseInt(options.top, 10) : 10
    try {
      const results = await remoteSearch(query, {
        top,
        recent: options.recent,
        alpha: options.alpha !== undefined ? parseFloat(options.alpha) : undefined,
        before: options.before,
        after: options.after,
        weightVector: options.weightVector !== undefined ? parseFloat(options.weightVector) : undefined,
        weightRecency: options.weightRecency !== undefined ? parseFloat(options.weightRecency) : undefined,
        weightPath: options.weightPath !== undefined ? parseFloat(options.weightPath) : undefined,
        group: options.group as 'file' | 'module' | 'commit' | undefined,
        chunks: options.chunks,
        hybrid: options.hybrid,
        bm25Weight: options.bm25Weight !== undefined ? parseFloat(options.bm25Weight) : undefined,
      })
      console.log(renderResults(results))
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

  const alpha = options.alpha !== undefined ? parseFloat(options.alpha) : 0.8
  if (isNaN(alpha) || alpha < 0 || alpha > 1) {
    console.error('Error: --alpha must be a number between 0 and 1')
    process.exit(1)
  }

  let before: number | undefined
  let after: number | undefined

  if (options.before) {
    try {
      before = parseDateArg(options.before)
    } catch (err) {
      console.error(`Error: --before ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }
  if (options.after) {
    try {
      after = parseDateArg(options.after)
    } catch (err) {
      console.error(`Error: --after ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  // Parse three-signal ranking weights
  let weightVector: number | undefined
  let weightRecency: number | undefined
  let weightPath: number | undefined

  if (options.weightVector !== undefined) {
    weightVector = parseFloat(options.weightVector)
    if (isNaN(weightVector) || weightVector < 0) {
      console.error('Error: --weight-vector must be a non-negative number')
      process.exit(1)
    }
  }
  if (options.weightRecency !== undefined) {
    weightRecency = parseFloat(options.weightRecency)
    if (isNaN(weightRecency) || weightRecency < 0) {
      console.error('Error: --weight-recency must be a non-negative number')
      process.exit(1)
    }
  }
  if (options.weightPath !== undefined) {
    weightPath = parseFloat(options.weightPath)
    if (isNaN(weightPath) || weightPath < 0) {
      console.error('Error: --weight-path must be a non-negative number')
      process.exit(1)
    }
  }

  // Parse group mode
  let groupMode: GroupMode | undefined
  if (options.group !== undefined) {
    if (options.group !== 'file' && options.group !== 'module' && options.group !== 'commit') {
      console.error('Error: --group must be one of: file, module, commit')
      process.exit(1)
    }
    groupMode = options.group as GroupMode
  }

  // Parse BM25 weight for hybrid search
  let bm25Weight: number | undefined
  if (options.bm25Weight !== undefined) {
    bm25Weight = parseFloat(options.bm25Weight)
    if (isNaN(bm25Weight) || bm25Weight < 0 || bm25Weight > 1) {
      console.error('Error: --bm25-weight must be a number between 0 and 1')
      process.exit(1)
    }
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel
  const dualModel = codeModel !== textModel
  const noCache = options.cache === false

  const textProvider = buildProvider(providerType, textModel)
  const codeProvider = dualModel ? buildProvider(providerType, codeModel) : null

  // Embed the query with the text model (natural-language prose)
  const textEmbedding = await embedQuery(textProvider, textModel, query, noCache)

  const searchOpts = {
    topK,
    recent: options.recent ?? false,
    alpha,
    before,
    after,
    weightVector,
    weightRecency,
    weightPath,
    query,
    searchChunks: options.chunks ?? false,
    branch: options.branch,
  }

  let results
  if (options.hybrid) {
    // Hybrid search: BM25 (FTS5) + vector similarity
    results = hybridSearch(query, textEmbedding, { ...searchOpts, bm25Weight })
  } else if (dualModel && codeProvider) {
    // Dual-model search: embed with both models and merge results
    const codeEmbedding = await embedQuery(codeProvider, codeModel, query, noCache)
    const textResults = vectorSearch(textEmbedding, { ...searchOpts, model: textModel })
    const codeResults = vectorSearch(codeEmbedding, { ...searchOpts, model: codeModel })
    results = mergeSearchResults(textResults, codeResults, topK)
  } else {
    // Single-model search (backward-compatible)
    results = vectorSearch(textEmbedding, searchOpts)
  }

  if (groupMode) {
    results = groupResults(results, groupMode, topK)
  }

  console.log(renderResults(results))

  // Optional commit message search
  if (options.includeCommits) {
    const commitResults = searchCommits(textEmbedding, { topK, model: textModel })
    console.log('\nCommit matches:')
    console.log(renderCommitResults(commitResults))
  }
}
