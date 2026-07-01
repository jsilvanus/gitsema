import { writeFileSync, existsSync } from 'node:fs'
import { resolveOutputs, writeToSink, hasSinkFormat, getSink, collectOut } from '../../utils/outputSink.js'
export { collectOut }
import { embedQuery as sharedEmbedQuery } from '../../core/embedding/embedQuery.js'
import type { Embedding, SearchResult } from '../../core/models/types.js'
import { vectorSearch, vectorSearchWithAnn, mergeSearchResults, type VectorSearchOptions } from '../../core/search/analysis/vectorSearch.js'
import { hybridSearch } from '../../core/search/analysis/hybridSearch.js'
import { renderResults, renderResultsByLevel, groupResults, formatScore, formatDate, shortHash, type GroupMode } from '../../core/search/ranking.js'
import { parseBooleanQuery, mergeOr, mergeAnd } from '../../core/search/analysis/booleanSearch.js'
import { parseDateArg } from '../../core/search/temporal/timeSearch.js'
import { remoteSearch } from '../../client/remoteClient.js'
import { searchCommits, type CommitSearchResult } from '../../core/search/commitSearch.js'
import { getRawDb } from '../../core/db/sqlite.js'
import { buildProviderOrExit, resolveModels } from '../lib/provider.js'
import { getModelProfile } from '../../core/config/configManager.js'
import { splitIdentifier } from '../../core/search/clustering/labelEnhancer.js'
import { narrateSearchResults } from '../../core/llm/narrator.js'
import { formatExplainForLlm } from '../../core/search/analysis/explainFormatter.js'

/** Maps an indexing-side `ModelProfile.level` (`blob`/`file`/`function`/`fixed`) to the search-side
 * level vocabulary (`file`/`chunk`/`symbol`/`module`); already-search-native values pass through
 * unchanged. Phase 77 Goal #4. */
const INDEX_LEVEL_TO_SEARCH_LEVEL: Record<string, string> = { blob: 'file', file: 'file', function: 'chunk', fixed: 'chunk' }

export function mapModelLevelToSearchLevel(level: string | undefined): string | undefined {
  if (!level) return undefined
  return INDEX_LEVEL_TO_SEARCH_LEVEL[level] ?? level
}

/** Level-isolating flags for one `runLevelPipeline()` call (Phase 136). */
export type LevelFlags = Pick<VectorSearchOptions, 'searchChunks' | 'searchSymbols' | 'searchModules' | 'includeFiles'>

export interface LevelSpec {
  name: 'chunk' | 'symbol' | 'module'
  flags: LevelFlags
}

/**
 * Resolves which non-file levels are active given the three additive
 * `vectorSearch()` flags, each paired with the isolating flag set
 * (`includeFiles: false`, only its own flag `true`) a per-level search call
 * needs to get a candidate pool scoped to just that level (Phase 136).
 */
export function resolveExtraLevels(searchChunksFlag: boolean, searchSymbolsFlag: boolean, searchModulesFlag: boolean): LevelSpec[] {
  const extraLevels: LevelSpec[] = []
  if (searchChunksFlag) extraLevels.push({ name: 'chunk', flags: { searchChunks: true, searchSymbols: false, searchModules: false, includeFiles: false } })
  if (searchSymbolsFlag) extraLevels.push({ name: 'symbol', flags: { searchChunks: false, searchSymbols: true, searchModules: false, includeFiles: false } })
  if (searchModulesFlag) extraLevels.push({ name: 'module', flags: { searchChunks: false, searchSymbols: false, searchModules: true, includeFiles: false } })
  return extraLevels
}

/**
 * True when 2+ of {chunk, symbol, module} are active at once — the trigger
 * for Phase 136's default per-level-list separation (an explicit combination
 * like `--chunks --level symbol`, or the Phase 77 Goal #4 model-level-fallback
 * union). A single active non-file level keeps the pre-Phase-136 merged
 * behavior (file + that one level in one ranked list) unchanged.
 */
export function isMultiLevelActive(extraLevels: LevelSpec[]): boolean {
  return extraLevels.length >= 2
}

export interface LevelUnionResult {
  searchChunks: boolean
  searchSymbols: boolean
  searchModules: boolean
  /** True when either model contributed a level (including plain 'file', which needs no flag). */
  resolved: boolean
}

/**
 * Unions the search-flags implied by whichever of two already-mapped
 * per-model levels are set (Phase 77 Goal #4). `vectorSearch()`'s
 * searchChunks/searchSymbols/searchModules flags are additive, not
 * exclusive — a single call already merges file + chunk + symbol + module
 * candidates into one ranked pool (`vectorSearch.ts`) — so when the text
 * and code models' saved levels differ, both are searched rather than one
 * winning, the same way dual-model search already merges two models'
 * results rather than picking one.
 */
export function unionModelLevels(textLevel: string | undefined, codeLevel: string | undefined): LevelUnionResult {
  const result: LevelUnionResult = { searchChunks: false, searchSymbols: false, searchModules: false, resolved: false }
  for (const level of [textLevel, codeLevel]) {
    if (level === undefined) continue
    result.resolved = true
    if (level === 'chunk') result.searchChunks = true
    else if (level === 'symbol') result.searchSymbols = true
    else if (level === 'module') result.searchModules = true
    // 'file' needs no flag — it's always included in vectorSearch()'s base candidate pool.
  }
  return result
}

export interface SearchCommandOptions {
  top?: string
  recent?: boolean
  alpha?: string
  before?: string
  after?: string
  /** Alias for --after: only include blobs first seen at or after this date. Used when --after is unset. */
  since?: string
  /** Alias for --before: only include blobs first seen before this date. Used when --before is unset. */
  until?: string
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
   * When true, merge all active search levels into one shared-cutoff ranked
   * list (pre-Phase-136 behavior) instead of returning separate per-level
   * lists. Only meaningful when more than one non-file level is active.
   */
  mergeLevels?: boolean
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
  const { providerType, textModel, codeModel } = resolveModels({
    model: options.model,
    textModel: options.textModel,
    codeModel: options.codeModel,
  })

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

  // --before/--after take precedence; --until/--since are aliases used when unset.
  const beforeArg = options.before ?? options.until
  const afterArg = options.after ?? options.since

  if (beforeArg) {
    try {
      before = parseDateArg(beforeArg)
    } catch (err) {
      console.error(`Error: --before/--until ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }
  if (afterArg) {
    try {
      after = parseDateArg(afterArg)
    } catch (err) {
      console.error(`Error: --after/--since ${err instanceof Error ? err.message : String(err)}`)
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

  // Phase 77 Goal #4: a saved per-model level (`gitsema models add <name>
  // --level ...`) takes priority over the embed_config auto-recall below.
  // When the text and code models' saved levels differ, both are searched
  // (union of flags) rather than either one winning — see unionModelLevels().
  let resolvedFromModelLevel = false
  if (!effectiveLevel) {
    const textLevel = mapModelLevelToSearchLevel(getModelProfile(textModel).level)
    const codeLevel = dualModel ? mapModelLevelToSearchLevel(getModelProfile(codeModel).level) : textLevel
    const union = unionModelLevels(textLevel, codeLevel)
    if (union.resolved) {
      resolvedFromModelLevel = true
      searchChunksFlag = searchChunksFlag || union.searchChunks
      searchSymbolsFlag = union.searchSymbols
      searchModulesFlag = union.searchModules
    }
  }

  if (!effectiveLevel && !resolvedFromModelLevel) {
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

  let results: SearchResult[] = []
  let resultsByLevel: Record<string, SearchResult[]> | undefined
  const _searchStartMs = Date.now()

  // Level-invariant work, hoisted above the per-level loop and computed (at
  // most) once regardless of how many levels are searched below: dual-model
  // code embedding, the second half of a boolean AND/OR query, --or/--and
  // query embeddings, and the --repos multi-repo result set. None of these
  // depend on which level flags a given `runLevelPipeline()` call uses, so
  // recomputing them per level (as an earlier draft of this phase did) would
  // mean redundant embedding calls and DB round-trips per extra level.
  let codeEmbedding: Embedding | undefined
  if (dualModel && codeProvider) {
    try {
      codeEmbedding = await sharedEmbedQuery(codeProvider, query, { noCache })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not embed query — ${msg}`)
      process.exit(1)
      throw err
    }
  }

  const parsedBool = parseBooleanQuery(query)
  let boolPartBEmbedding: Embedding | undefined
  if (parsedBool) {
    try {
      boolPartBEmbedding = await sharedEmbedQuery(textProvider, parsedBool.parts[1], { noCache })
    } catch (err) {
      // On failure, runLevelPipeline falls back to its precomputed results below
    }
  }

  let orEmbedding: Embedding | undefined
  if (options.or) {
    try {
      orEmbedding = await sharedEmbedQuery(textProvider, options.or, { noCache })
    } catch (err) {
      // ignore
    }
  }

  let andEmbedding: Embedding | undefined
  if (options.and) {
    try {
      andEmbedding = await sharedEmbedQuery(textProvider, options.and, { noCache })
    } catch (err) {
      // ignore
    }
  }

  let repoResults: SearchResult[] | undefined
  if (options.repos) {
    try {
      const { multiRepoSearch } = await import('../../core/indexing/repoRegistry.js')
      const { getActiveSession } = await import('../../core/db/sqlite.js')
      const session = getActiveSession()
      const repoIds = options.repos.split(',').map((s) => s.trim()).filter(Boolean)
      repoResults = await multiRepoSearch(session, Array.from(textEmbedding) as number[], {
        repoIds: repoIds.length > 0 ? repoIds : undefined,
        topK,
        model: textModel,
      })
    } catch (err) {
      console.error(`Warning: multi-repo search failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Runs the full single-list search pipeline (vector/hybrid/dual-model search,
  // --repos merge, boolean AND/OR query, --or/--and, --group, --annotate-clusters)
  // scoped to one set of level flags. Used once with the union of active flags
  // for the merged (pre-Phase-136 / --merge-levels) path, and once per level
  // — each isolated to a single flag via `includeFiles: false` — for the new
  // default per-level-list path, so every call applies these options
  // identically to how the single merged call always has (Phase 136).
  async function runLevelPipeline(levelFlags: LevelFlags): Promise<SearchResult[]> {
    const levelSearchOpts: VectorSearchOptions = { ...searchOpts, ...levelFlags }
    let levelResults: SearchResult[]

    if (options.hybrid) {
      levelResults = await hybridSearch(query, textEmbedding, { ...levelSearchOpts, bm25Weight })
    } else if (dualModel && codeProvider && codeEmbedding) {
      const topKExtended = topK * 2
      const textResults = await vectorSearchWithAnn(textEmbedding, { ...levelSearchOpts, model: textModel, topK: topKExtended, useVss: !!options.vss })
      const codeResults = await vectorSearchWithAnn(codeEmbedding, { ...levelSearchOpts, model: codeModel, topK: topKExtended, useVss: !!options.vss })
      levelResults = mergeSearchResults(textResults, codeResults, topK)
    } else {
      // Single-model: vectorSearchWithAnn auto-routes through HNSW when a VSS
      // index exists (--vss flag) or when the index exceeds GITSEMA_VSS_THRESHOLD.
      levelResults = await vectorSearchWithAnn(textEmbedding, { ...levelSearchOpts, useVss: !!options.vss })
    }

    // --repos: merge results across registered repositories (computed once, above)
    if (repoResults) {
      const combined = [...levelResults, ...repoResults]
      combined.sort((a, b) => b.score - a.score)
      levelResults = combined.slice(0, topK)
    }

    // Support boolean/composite queries: detect "A AND B" or "A OR B" in the main query
    if (parsedBool && boolPartBEmbedding) {
      try {
        const resA = await vectorSearch(textEmbedding, { ...levelSearchOpts, topK })
        const resB = await vectorSearch(boolPartBEmbedding, { ...levelSearchOpts, topK })
        levelResults = parsedBool.op === 'OR' ? mergeOr(resA, resB, topK) : mergeAnd(resA, resB, topK)
      } catch (err) {
        // On failure fall back to the precomputed results
      }
    }

    // CLI flags: --or / --and to combine with an additional query
    if (orEmbedding) {
      try {
        const orResults = await vectorSearch(orEmbedding, { ...levelSearchOpts, topK })
        levelResults = mergeOr(levelResults, orResults, topK)
      } catch (err) {
        // ignore
      }
    }
    if (andEmbedding) {
      try {
        const andResults = await vectorSearch(andEmbedding, { ...levelSearchOpts, topK })
        levelResults = mergeAnd(levelResults, andResults, topK)
      } catch (err) {
        // ignore
      }
    }

    if (groupMode) {
      levelResults = groupResults(levelResults, groupMode, topK)
    }

    // --annotate-clusters: join each result with its cluster label (if a clustering run exists)
    if (options.annotateClusters && levelResults.length > 0) {
      try {
        const rawDb = getRawDb()
        const hashes = levelResults.map((r) => `'${r.blobHash}'`).join(',')
        const rows = rawDb.prepare(
          `SELECT ca.blob_hash, bc.label FROM cluster_assignments ca
           JOIN blob_clusters bc ON bc.id = ca.cluster_id
           WHERE ca.blob_hash IN (${hashes})`
        ).all() as Array<{ blob_hash: string; label: string }>
        const labelMap = new Map(rows.map((r) => [r.blob_hash, r.label]))
        for (const r of levelResults) {
          if (labelMap.has(r.blobHash)) r.clusterLabel = labelMap.get(r.blobHash)
        }
      } catch {
        // cluster_assignments table may not exist (no clustering run yet) — silently skip
      }
    }

    return levelResults
  }

  // Phase 136: whenever more than one of {chunk, symbol, module} is active at
  // once — an explicit combination like `--chunks --level symbol`, or the
  // Phase 77 Goal #4 model-level-fallback union when the text/code models'
  // saved levels disagree — separate, independently-ranked lists become the
  // default (one isolated `runLevelPipeline()` call per level, each with its
  // own topK cutoff) instead of merging every level into one shared-cutoff
  // ranked list. `--merge-levels` opts back into the pre-Phase-136 single
  // merged call. A single active level (the common case) is unaffected.
  const extraLevels = resolveExtraLevels(searchChunksFlag, searchSymbolsFlag, searchModulesFlag)
  const multiLevelActive = isMultiLevelActive(extraLevels)

  if (multiLevelActive && !options.mergeLevels) {
    resultsByLevel = {}
    resultsByLevel.file = await runLevelPipeline({ searchChunks: false, searchSymbols: false, searchModules: false, includeFiles: true })
    for (const level of extraLevels) {
      resultsByLevel[level.name] = await runLevelPipeline(level.flags)
    }
  } else {
    results = await runLevelPipeline({ searchChunks: searchChunksFlag, searchSymbols: searchSymbolsFlag, searchModules: searchModulesFlag, includeFiles: true })
  }

  // Optional commit message search (level-independent — commit messages aren't file/chunk/symbol/module blobs)
  let commitResults
  if (options.includeCommits) {
    commitResults = await searchCommits(textEmbedding, { topK, model: textModel })
  }

  // Unified output handling (--out, or legacy --dump / --html). The JSON
  // payload shape intentionally differs (`resultsByLevel` vs. `results`) so
  // existing single-list JSON consumers see an unchanged shape, but the
  // HTML/text/explain-llm/narrate/slow-query-hint logic below is otherwise
  // identical for both paths and so is written once against `allResults`
  // (the flattened per-level lists, or `results` unchanged when not
  // multi-level).
  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: options.html })
  const allResults: SearchResult[] = resultsByLevel ? Object.values(resultsByLevel).flat() : results

  // JSON sink
  const jsonSink = getSink(sinks, 'json')
  if (jsonSink) {
    const payload: Record<string, unknown> = resultsByLevel ? { resultsByLevel } : { results }
    if (commitResults) payload.commits = commitResults
    writeToSink(jsonSink, JSON.stringify(payload, null, 2), 'Search results JSON')
    if (!hasSinkFormat(sinks, 'text') && !hasSinkFormat(sinks, 'html')) return
  }

  // HTML sink: for per-level results, concatenates all levels (each result is still tagged with its `kind`)
  const htmlSink = getSink(sinks, 'html')
  if (htmlSink) {
    const { renderSearchHtml } = await import('../../core/viz/htmlRenderer.js')
    const html = renderSearchHtml(allResults, query)
    const outFile = htmlSink.file ?? 'search.html'
    writeFileSync(outFile, html, 'utf8')
    console.log(`Search HTML written to: ${outFile}`)
    if (!hasSinkFormat(sinks, 'text')) return
  }

  // Default text output: one labeled section per level, or a flat list when not multi-level
  if (hasSinkFormat(sinks, 'text') || (!jsonSink && !htmlSink)) {
    console.log(resultsByLevel ? renderResultsByLevel(resultsByLevel, !options.noHeadings) : renderResults(results, !options.noHeadings))

    if (commitResults) {
      console.log('\nCommit matches:')
      console.log(renderCommitResults(commitResults))
    }

    // LLM-ready provenance citations (--explain-llm)
    if (options.explainLlm && allResults.length > 0) {
      console.log('\n=== Provenance Citations (LLM Context) ===')
      console.log(formatExplainForLlm(allResults, { includeSnippet: true }))
    }

    // LLM narration of search results
    if (options.narrate && allResults.length > 0) {
      console.log('')
      console.log('=== LLM Search Narrative ===')
      const narrative = await narrateSearchResults(query, allResults)
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
