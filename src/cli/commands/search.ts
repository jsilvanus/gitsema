import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery as sharedEmbedQuery } from '../../core/embedding/embedQuery.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import { vectorSearch, mergeSearchResults } from '../../core/search/vectorSearch.js'
import { hybridSearch } from '../../core/search/hybridSearch.js'
import { renderResults, groupResults, formatScore, formatDate, shortHash, type GroupMode } from '../../core/search/ranking.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { remoteSearch } from '../../client/remoteClient.js'
import { searchCommits, type CommitSearchResult } from '../../core/search/commitSearch.js'
import { getRawDb } from '../../core/db/sqlite.js'

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

  // Resolve --level flag to per-table search flags
  let searchChunksFlag = options.chunks ?? false
  let searchSymbolsFlag = false
  let searchModulesFlag = false
  if (options.level) {
    switch (options.level) {
      case 'file': break
      case 'chunk': searchChunksFlag = true; break
      case 'symbol': searchSymbolsFlag = true; break
      case 'module': searchModulesFlag = true; break
      default:
        console.error('Error: --level must be one of: file, chunk, symbol, module')
        process.exit(1)
    }
  }

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
    searchChunks: searchChunksFlag,
    searchSymbols: searchSymbolsFlag,
    searchModules: searchModulesFlag,
    branch: options.branch,
  }

  let results
  if (options.vss) {
    // Attempt ANN search via usearch if available and index file exists
    try {
      const usearch = await import('usearch')
      const providerModel = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const modelToUse = options.model ?? providerModel
      const safeName = modelToUse.replace(/[^a-zA-Z0-9._-]/g, '_')
      const indexPath = `.gitsema/vectors-${safeName}.usearch`
      const mapPath = `.gitsema/vectors-${safeName}.map.json`
      const fs = await import('node:fs')
      if (!fs.existsSync(indexPath) || !fs.existsSync(mapPath)) {
        console.warn('VSS index not found; falling back to linear scan')
        // fall back to regular logic below
      } else {
        const mapJson = fs.readFileSync(mapPath, 'utf8')
        const idToHash: string[] = JSON.parse(mapJson)

        const Index = (usearch as any).Index ?? (usearch as any).default?.Index
        if (!Index) {
          console.warn('usearch package does not export Index; falling back to linear scan')
        } else {
          // Try to load index
          let index: any = null
          try {
            if (typeof (Index as any).load === 'function') {
              index = (Index as any).load(indexPath)
            } else {
              index = new Index()
              if (typeof index.load === 'function') {
                index.load(indexPath)
              } else {
                index = null
              }
            }
          } catch {
            index = null
          }

          if (index) {
            const queryVec = new Float32Array(textEmbedding)
            const res = index.search(queryVec, topK)
            const keys: number[] = (res as any).keys ?? (res as any).ids ?? []
            const distances: number[] = (res as any).distances ?? (res as any).dists ?? []

            // If index seems stale, warn but continue (we can still return top results)
            if (idToHash.length < (await import('../../core/db/sqlite.js')).getRawDb().prepare('SELECT COUNT(*) as c FROM embeddings WHERE model = ?').get(modelToUse).c) {
              console.warn('VSS index appears stale (fewer entries than DB). Consider rebuilding with `gitsema build-vss`.')
            }

            // Map results to SearchResult format and fetch paths
            const selectedHashes = keys.map((k) => idToHash[k])
            const dbRows = (await import('../../core/db/sqlite.js')).getRawDb().prepare(
              `SELECT blob_hash, path FROM paths WHERE blob_hash IN (${selectedHashes.map(() => '?').join(',')})`
            ).all(...selectedHashes) as Array<{ blob_hash: string; path: string }>

            const pathsByHash = new Map<string, string[]>()
            for (const r of dbRows) {
              const list = pathsByHash.get(r.blob_hash) ?? []
              list.push(r.path)
              pathsByHash.set(r.blob_hash, list)
            }

            results = keys.map((k, i) => {
              const h = idToHash[k]
              return {
                blobHash: h,
                paths: pathsByHash.get(h) ?? [],
                score: distances[i] ?? 0,
              }
            })
          }
        }
      }
    } catch (err) {
      console.warn('VSS search failed; falling back to linear scan')
    }
  }

  if (!results) {
    if (options.hybrid) {
      // Hybrid search: BM25 (FTS5) + vector similarity
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
      const textResults = vectorSearch(textEmbedding, { ...searchOpts, model: textModel, topK: topKExtended })
      const codeResults = vectorSearch(codeEmbedding, { ...searchOpts, model: codeModel, topK: topKExtended })
      results = mergeSearchResults(textResults, codeResults, topK)
    } else {
      // Single-model search (backward-compatible)
      results = vectorSearch(textEmbedding, searchOpts)
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

  // --dump: emit structured JSON instead of human-readable output
  if (options.dump !== undefined) {
    const payload: Record<string, unknown> = { results }
    if (commitResults) payload.commits = commitResults
    const json = JSON.stringify(payload, null, 2)
    if (typeof options.dump === 'string') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`Search results JSON written to: ${options.dump}`)
    } else {
      process.stdout.write(json + '\n')
    }
    return
  }

  console.log(renderResults(results))

  if (commitResults) {
    console.log('\nCommit matches:')
    console.log(renderCommitResults(commitResults))
  }
}
