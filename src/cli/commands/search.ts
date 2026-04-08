import { writeFileSync, existsSync } from 'node:fs'
import { resolveOutputs, writeToSink, hasSinkFormat, getSink, collectOut } from '../../utils/outputSink.js'
export { collectOut }
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery as sharedEmbedQuery } from '../../core/embedding/embedQuery.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding, SearchResult } from '../../core/models/types.js'
import { vectorSearch, vectorSearchWithAnn, mergeSearchResults, type VectorSearchOptions } from '../../core/search/vectorSearch.js'
import { hybridSearch } from '../../core/search/hybridSearch.js'
import { renderResults, groupResults, formatScore, formatDate, shortHash, type GroupMode } from '../../core/search/ranking.js'
import { parseBooleanQuery, mergeOr, mergeAnd } from '../../core/search/booleanSearch.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { remoteSearch } from '../../client/remoteClient.js'
import { searchCommits, type CommitSearchResult } from '../../core/search/commitSearch.js'
import { getRawDb } from '../../core/db/sqlite.js'
import { splitIdentifier } from '../../core/search/labelEnhancer.js'
import { narrateSearchResults } from '../../core/llm/narrator.js'
import { formatExplainForLlm } from '../../core/search/explainFormatter.js'

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
  /** Search granularity level: 'file' (default), 'chunk', 'symbol', or 'module'. */
  level?: string
  /**
   * When true, annotate each result with the cluster label from `cluster_assignments`
   * (requires a prior `gitsema clusters` run to have populated the table).
   */
  annotateClusters?: boolean
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
  /** Negative example: a query whose similarity should be subtracted from the score */
  notLike?: string
  /** Weight for negative example (default 0.5) */
  lambda?: string
  /** When true, print signal breakdown for each result */
  explain?: boolean
  /** Limit candidate pool to this many random samples for large indexes (0 = disabled) */
  earlyCut?: string
  /** When true, output LLM-ready provenance citations for each result */
  explainLlm?: boolean
  /** Output interactive HTML (writes to <file> if supplied, otherwise search.html) */
  html?: string | boolean
  /** Unified output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] */
  out?: string[]
  /** Combine results with another query via OR (union, max score) */
  or?: string
  /** Combine results with another query via AND (intersection, harmonic mean) */
  and?: string
  /** When true, expand query with top BM25 keywords before embedding (improves recall) */
  expandQuery?: boolean
  /** When true, generate an LLM narrative summary of search results */
  narrate?: boolean
  /** Comma-separated repo IDs to search (multi-repo mode, requires registered repos with db_path) */
  repos?: string
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

  // Apply CLI model overrides to environment so provider factories pick them up
  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

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
      console.log(renderResults(results, !options.noHeadings))
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

  const textProvider = buildProviderOrExit(providerType, textModel)
  const codeProvider = dualModel ? buildProviderOrExit(providerType, codeModel) : null

  // Embed the query with the text model (natural-language prose)
  let textEmbedding: Embedding
  try {
    textEmbedding = await sharedEmbedQuery(textProvider, query, { noCache })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
    throw err
  }

  // Phase 52: Query Expansion — expand query with top BM25 keywords before re-embedding
  let effectiveQuery = query
  if (options.expandQuery) {
    try {
      const rawDb = getRawDb()
      const ftsRows = rawDb.prepare(
        `SELECT blob_hash FROM blob_fts WHERE blob_fts MATCH ? ORDER BY bm25(blob_fts) LIMIT 5`,
      ).all(query.replace(/['"]/g, '')) as Array<{ blob_hash: string }>
      if (ftsRows.length > 0) {
        const hashes = ftsRows.map((r) => r.blob_hash)
        const placeholders = hashes.map(() => '?').join(',')
        const contentRows = rawDb.prepare(
          `SELECT content FROM blob_fts WHERE blob_hash IN (${placeholders}) LIMIT 5`,
        ).all(...(hashes as [string, ...string[]])) as Array<{ content: string }>
        const allTokens: string[] = []
        for (const row of contentRows) {
          const words = row.content.split(/\s+/).slice(0, 30)
          for (const w of words) {
            allTokens.push(...splitIdentifier(w))
          }
        }
        // Pick top-5 unique tokens not already in the query
        const queryLower = query.toLowerCase()
        const expansion = [...new Set(allTokens)]
          .filter((t) => t.length > 2 && !queryLower.includes(t.toLowerCase()))
          .slice(0, 5)
        if (expansion.length > 0) {
          effectiveQuery = `${query} ${expansion.join(' ')}`
          if (process.env.GITSEMA_VERBOSE) {
            console.error(`[expand-query] expanded to: ${effectiveQuery}`)
          }
          textEmbedding = await sharedEmbedQuery(textProvider, effectiveQuery, { noCache: true })
        }
      }
    } catch {
      // If expansion fails, fall through with original embedding
    }
  }

  // Resolve --level flag to per-table search flags
  let searchChunksFlag = options.chunks ?? false
  let searchSymbolsFlag = false
  let searchModulesFlag = false

  // Phase 77: auto-recall level from active embed_config when --level is not specified
  let effectiveLevel = options.level
  if (!effectiveLevel) {
    try {
      const { loadEmbedConfigs } = await import('../../core/indexing/provenance.js')
      const { getRawDb } = await import('../../core/db/sqlite.js')
      const configs = loadEmbedConfigs(getRawDb())
      if (configs.length > 0) {
        // Use the most recently used config
        const latest = configs.reduce((a, b) => ((b.lastUsedAt ?? 0) >= (a.lastUsedAt ?? 0) ? b : a))
        const chunkerToLevel: Record<string, string> = { file: 'file', function: 'chunk', fixed: 'chunk' }
        effectiveLevel = chunkerToLevel[latest.chunker]
      }
    } catch (err) {
      if (process.env.GITSEMA_VERBOSE) {
        console.debug(`[gitsema] auto-recall level: could not load embed_config: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  if (effectiveLevel) {
    switch (effectiveLevel) {
      case 'file': break
      case 'chunk': searchChunksFlag = true; break
      case 'symbol': searchSymbolsFlag = true; break
      case 'module': searchModulesFlag = true; break
      default:
        console.error('Error: --level must be one of: file, chunk, symbol, module')
        process.exit(1)
    }
  }

  // Prepare search options; negative/explain handled below
  const searchOpts: VectorSearchOptions = {
    topK,
    recent: options.recent ?? false,
    alpha,
    before,
    after,
    weightVector,
    weightRecency,
    weightPath,
    query,
    searchChunks: searchChunksFlag,
    searchSymbols: searchSymbolsFlag,
    searchModules: searchModulesFlag,
    branch: options.branch,
  }

  // Handle negative example embedding when provided
  let negativeEmbedding: Embedding | undefined
  const negativeLambda = options.lambda !== undefined ? parseFloat(options.lambda) : 0.5
  if (options.notLike) {
    try {
      negativeEmbedding = await sharedEmbedQuery(textProvider, options.notLike, { noCache })
      searchOpts.negativeQueryEmbedding = negativeEmbedding
      searchOpts.negativeLambda = negativeLambda
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not embed negative example — ${msg}`)
      process.exit(1)
    }
  }

  if (options.explain) searchOpts.explain = true
  if (options.earlyCut !== undefined) {
    const ec = parseInt(options.earlyCut, 10)
    if (!isNaN(ec) && ec > 0) searchOpts.earlyCut = ec
  }

  // Auto-detect VSS index for user feedback; actual routing is handled by
  // vectorSearchWithAnn() which checks both the --vss flag and the index size.
  if (!options.vss) {
    const safeName = textModel.replace(/[^a-zA-Z0-9._-]/g, '_')
    if (existsSync(`.gitsema/vectors-${safeName}.usearch`) && existsSync(`.gitsema/vectors-${safeName}.map.json`)) {
      options.vss = true
      console.error('Info: Using ANN index (run `gitsema index build-vss` to rebuild).')
    }
  }

  let results: SearchResult[] | undefined
  const _searchStartMs = Date.now()

  if (options.hybrid) {
    // Hybrid search: BM25 (FTS5) + vector similarity (no ANN pre-filter)
    results = hybridSearch(query, textEmbedding, { ...searchOpts, bm25Weight })
  } else if (dualModel && codeProvider) {
    // Dual-model search: embed with both models and merge results
    let codeEmbedding: Embedding
    try {
      codeEmbedding = await sharedEmbedQuery(codeProvider, query, { noCache })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not embed query — ${msg}`)
      process.exit(1)
      throw err
    }
    const topKExtended = topK * 2
    const textResults = await vectorSearchWithAnn(textEmbedding, { ...searchOpts, model: textModel, topK: topKExtended, useVss: !!options.vss })
    const codeResults = await vectorSearchWithAnn(codeEmbedding, { ...searchOpts, model: codeModel, topK: topKExtended, useVss: !!options.vss })
    results = mergeSearchResults(textResults, codeResults, topK)
  } else {
    // Single-model: vectorSearchWithAnn auto-routes through HNSW when a VSS
    // index exists (--vss flag) or when the index exceeds GITSEMA_VSS_THRESHOLD.
    results = await vectorSearchWithAnn(textEmbedding, { ...searchOpts, useVss: !!options.vss })
  }

  // --repos: merge results across registered repositories
  if (options.repos) {
    try {
      const { multiRepoSearch } = await import('../../core/indexing/repoRegistry.js')
      const { getActiveSession } = await import('../../core/db/sqlite.js')
      const session = getActiveSession()
      const repoIds = options.repos.split(',').map((s) => s.trim()).filter(Boolean)
      const multiResults = await multiRepoSearch(session, Array.from(textEmbedding) as number[], {
        repoIds: repoIds.length > 0 ? repoIds : undefined,
        topK,
        model: textModel,
      })
      // Merge local results with multi-repo results
      const combined = [...results, ...multiResults]
      combined.sort((a, b) => b.score - a.score)
      results = combined.slice(0, topK)
    } catch (err) {
      console.error(`Warning: multi-repo search failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Support boolean/composite queries: detect "A AND B" or "A OR B" in the main query
  const parsedBool = parseBooleanQuery(query)
  if (parsedBool) {
    try {
      const partA = parsedBool.parts[0]
      const partB = parsedBool.parts[1]
      const embA = textEmbedding
      const embB = await sharedEmbedQuery(textProvider, partB, { noCache })
      const resA = vectorSearch(embA, { ...searchOpts, topK })
      const resB = vectorSearch(embB, { ...searchOpts, topK })
      results = parsedBool.op === 'OR' ? mergeOr(resA, resB, topK) : mergeAnd(resA, resB, topK)
    } catch (err) {
      // On failure fall back to the precomputed results
    }
  }

  // CLI flags: --or / --and to combine with an additional query
  if (options.or) {
    try {
      const orEmb = await sharedEmbedQuery(textProvider, options.or, { noCache })
      const orResults = vectorSearch(orEmb, { ...searchOpts, topK })
      results = mergeOr(results, orResults, topK)
    } catch (err) {
      // ignore
    }
  }
  if (options.and) {
    try {
      const andEmb = await sharedEmbedQuery(textProvider, options.and, { noCache })
      const andResults = vectorSearch(andEmb, { ...searchOpts, topK })
      results = mergeAnd(results, andResults, topK)
    } catch (err) {
      // ignore
    }
  }

  if (groupMode) {
    results = groupResults(results, groupMode, topK)
  }

  // Optional commit message search
  let commitResults
  if (options.includeCommits) {
    commitResults = searchCommits(textEmbedding, { topK, model: textModel })
  }

  // --annotate-clusters: join each result with its cluster label (if a clustering run exists)
  if (options.annotateClusters && results.length > 0) {
    try {
      const rawDb = getRawDb()
      const hashes = results.map((r) => `'${r.blobHash}'`).join(',')
      const rows = rawDb.prepare(
        `SELECT ca.blob_hash, bc.label FROM cluster_assignments ca
         JOIN blob_clusters bc ON bc.id = ca.cluster_id
         WHERE ca.blob_hash IN (${hashes})`
      ).all() as Array<{ blob_hash: string; label: string }>
      const labelMap = new Map(rows.map((r) => [r.blob_hash, r.label]))
      for (const r of results) {
        if (labelMap.has(r.blobHash)) r.clusterLabel = labelMap.get(r.blobHash)
      }
    } catch {
      // cluster_assignments table may not exist (no clustering run yet) — silently skip
    }
  }

    // Unified output handling (--out, or legacy --dump / --html)
  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: options.html })

  // JSON sink
  const jsonSink = getSink(sinks, 'json')
  if (jsonSink) {
    const payload: Record<string, unknown> = { results }
    if (commitResults) payload.commits = commitResults
    writeToSink(jsonSink, JSON.stringify(payload, null, 2), 'Search results JSON')
    if (!hasSinkFormat(sinks, 'text') && !hasSinkFormat(sinks, 'html')) return
  }

  // HTML sink
  const htmlSink = getSink(sinks, 'html')
  if (htmlSink) {
    const { renderSearchHtml } = await import('../../core/viz/htmlRenderer.js')
    const html = renderSearchHtml(results, query)
    const outFile = htmlSink.file ?? 'search.html'
    writeFileSync(outFile, html, 'utf8')
    console.log(`Search HTML written to: ${outFile}`)
    if (!hasSinkFormat(sinks, 'text')) return
  }

  // Default text output
  if (hasSinkFormat(sinks, 'text') || (!jsonSink && !htmlSink)) {
    console.log(renderResults(results, !options.noHeadings))

    if (commitResults) {
      console.log('\nCommit matches:')
      console.log(renderCommitResults(commitResults))
    }

    // LLM-ready provenance citations (--explain-llm)
    if (options.explainLlm && results.length > 0) {
      console.log('\n=== Provenance Citations (LLM Context) ===')
      console.log(formatExplainForLlm(results, { includeSnippet: true }))
    }

    // LLM narration of search results
    if (options.narrate && results.length > 0) {
      console.log('')
      console.log('=== LLM Search Narrative ===')
      const narrative = await narrateSearchResults(query, results)
      console.log(narrative)
    }

    // First-slow-query hint: warn if this search took longer than threshold
    const _searchElapsedMs = Date.now() - _searchStartMs
    const _slowThresholdMs = parseInt(process.env.GITSEMA_SLOW_QUERY_THRESHOLD ?? '5000', 10)
    if (_searchElapsedMs > _slowThresholdMs) {
      console.log(`\n⚠  Slow search: ${(_searchElapsedMs / 1000).toFixed(1)}s. Consider running: gitsema index build-vss`)
    }
  }
}
