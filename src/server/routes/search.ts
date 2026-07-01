import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding, SearchResult } from '../../core/models/types.js'
import { vectorSearch, vectorSearchWithAnn, mergeSearchResults, type VectorSearchOptions } from '../../core/search/analysis/vectorSearch.js'
import { hybridSearch } from '../../core/search/analysis/hybridSearch.js'
import { parseDateArg } from '../../core/search/temporal/timeSearch.js'
import { renderResults, renderResultsByLevel, renderFirstSeenResults, groupResults } from '../../core/search/ranking.js'
import { searchCommits } from '../../core/search/commitSearch.js'
import type { GroupMode } from '../../core/search/ranking.js'
import { parseBooleanQuery, mergeOr, mergeAnd } from '../../core/search/analysis/booleanSearch.js'
import { formatExplainForLlm } from '../../core/search/analysis/explainFormatter.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import { multiRepoSearch } from '../../core/indexing/repoRegistry.js'
import { hasModelOverride, buildProviderForRequest, type ModelOverrideParams } from '../../core/embedding/providerFactory.js'
import {
  resolveExtraLevels,
  isMultiLevelActive,
  type LevelFlags,
} from '../../cli/commands/search.js'

const ModelOverrideSchema = {
  model: z.string().optional(),
  textModel: z.string().optional(),
  codeModel: z.string().optional(),
}

const SearchBodySchema = z.object({
  query: z.string().min(1),
  top: z.number().int().positive().optional().default(10),
  recent: z.boolean().optional().default(false),
  alpha: z.number().min(0).max(1).optional().default(0.8),
  before: z.string().optional(),
  after: z.string().optional(),
  weightVector: z.number().nonnegative().optional(),
  weightRecency: z.number().nonnegative().optional(),
  weightPath: z.number().nonnegative().optional(),
  group: z.enum(['file', 'module', 'commit']).optional(),
  chunks: z.boolean().optional().default(false),
  level: z.enum(['file', 'chunk', 'symbol', 'module']).optional(),
  mergeLevels: z.boolean().optional().default(false),
  hybrid: z.boolean().optional().default(false),
  bm25Weight: z.number().min(0).max(1).optional(),
  branch: z.string().optional(),
  includeCommits: z.boolean().optional().default(false),
  // rendered=true returns human-readable string; false (default) returns JSON array
  rendered: z.boolean().optional().default(false),
  // Phase 138: query-shaping flags restored to parity with CLI `search`.
  notLike: z.string().optional(),
  lambda: z.number().optional().default(0.5),
  or: z.string().optional(),
  and: z.string().optional(),
  explain: z.boolean().optional().default(false),
  explainLlm: z.boolean().optional().default(false),
  expandQuery: z.boolean().optional().default(false),
  annotateClusters: z.boolean().optional().default(false),
  vss: z.boolean().optional().default(false),
  earlyCut: z.number().int().positive().optional(),
  noCache: z.boolean().optional().default(false),
  repos: z.array(z.string()).optional(),
  ...ModelOverrideSchema,
})

const FirstSeenBodySchema = z.object({
  query: z.string().min(1),
  top: z.number().int().positive().optional().default(10),
  hybrid: z.boolean().optional().default(false),
  bm25Weight: z.number().min(0).max(1).optional(),
  branch: z.string().optional(),
  includeCommits: z.boolean().optional().default(false),
  rendered: z.boolean().optional().default(false),
  noHeadings: z.boolean().optional().default(false),
  // Phase 138: parity flags.
  vss: z.boolean().optional().default(false),
  repos: z.array(z.string()).optional(),
  ...ModelOverrideSchema,
})

export interface SearchRouterDeps {
  textProvider: EmbeddingProvider
  codeProvider?: EmbeddingProvider
}

/**
 * Annotates results in-place with cluster labels from `cluster_assignments`
 * (mirrors CLI `search --annotate-clusters`). Silently no-ops if the table
 * doesn't exist (no prior `gitsema clusters` run).
 */
function annotateClusters(results: SearchResult[]): void {
  if (results.length === 0) return
  try {
    const { rawDb } = getActiveSession()
    const hashes = results.map((r) => `'${r.blobHash}'`).join(',')
    const rows = rawDb.prepare(
      `SELECT ca.blob_hash, bc.label FROM cluster_assignments ca
       JOIN blob_clusters bc ON bc.id = ca.cluster_id
       WHERE ca.blob_hash IN (${hashes})`,
    ).all() as Array<{ blob_hash: string; label: string }>
    const labelMap = new Map(rows.map((r) => [r.blob_hash, r.label]))
    for (const r of results) {
      if (labelMap.has(r.blobHash)) r.clusterLabel = labelMap.get(r.blobHash)
    }
  } catch {
    // cluster_assignments table may not exist — silently skip
  }
}

export function searchRouter(deps: SearchRouterDeps): Router {
  const { textProvider: defaultTextProvider, codeProvider: defaultCodeProvider } = deps
  const router = Router()

  router.post('/', async (req, res) => {
    const parsed = SearchBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    const opts = parsed.data

    let before: number | undefined
    let after: number | undefined
    try {
      if (opts.before) before = parseDateArg(opts.before)
      if (opts.after) after = parseDateArg(opts.after)
    } catch (err) {
      res.status(400).json({ error: `Date parse error: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    // Phase 138: per-request model overrides (falls back to the server's
    // startup-configured providers when not given).
    const override: ModelOverrideParams = { model: opts.model, textModel: opts.textModel, codeModel: opts.codeModel }
    let textProvider: EmbeddingProvider
    let codeProvider: EmbeddingProvider | undefined
    try {
      if (hasModelOverride(override)) {
        textProvider = buildProviderForRequest(override, 'text')
        codeProvider = buildProviderForRequest(override, 'code', !!defaultCodeProvider)
      } else {
        textProvider = defaultTextProvider
        codeProvider = defaultCodeProvider
      }
    } catch (err) {
      res.status(400).json({ error: `Model override failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    const noCache = opts.noCache === true

    let textEmbedding: Embedding
    try {
      textEmbedding = await textProvider.embed(opts.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    // --not-like: negative example embedding
    let negativeEmbedding: Embedding | undefined
    if (opts.notLike) {
      try {
        negativeEmbedding = await textProvider.embed(opts.notLike)
      } catch (err) {
        res.status(502).json({ error: `Negative example embedding failed: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
    }

    const dualModel = !!codeProvider && codeProvider.model !== textProvider.model

    const searchOpts: VectorSearchOptions = {
      topK: opts.top,
      recent: opts.recent,
      alpha: opts.alpha,
      before,
      after,
      weightVector: opts.weightVector,
      weightRecency: opts.weightRecency,
      weightPath: opts.weightPath,
      query: opts.query,
      searchChunks: opts.chunks || opts.level === 'chunk',
      searchSymbols: opts.level === 'symbol',
      searchModules: opts.level === 'module',
      branch: opts.branch,
      negativeQueryEmbedding: negativeEmbedding,
      negativeLambda: negativeEmbedding ? opts.lambda : undefined,
      explain: opts.explain,
      earlyCut: opts.earlyCut,
      noCache,
    }

    // Level-invariant work, computed once regardless of how many levels are
    // searched below (mirrors CLI `search`'s Phase 136/138 structure).
    let codeEmbedding: Embedding | undefined
    if (dualModel && codeProvider) {
      try {
        codeEmbedding = await codeProvider.embed(opts.query)
      } catch (err) {
        res.status(502).json({ error: `Code embedding failed: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
    }

    const parsedBool = parseBooleanQuery(opts.query)
    let boolPartBEmbedding: Embedding | undefined
    if (parsedBool) {
      try {
        boolPartBEmbedding = await textProvider.embed(parsedBool.parts[1])
      } catch {
        // fall through to precomputed results below
      }
    }

    let orEmbedding: Embedding | undefined
    if (opts.or) {
      try {
        orEmbedding = await textProvider.embed(opts.or)
      } catch {
        // ignore
      }
    }

    let andEmbedding: Embedding | undefined
    if (opts.and) {
      try {
        andEmbedding = await textProvider.embed(opts.and)
      } catch {
        // ignore
      }
    }

    let repoResults: SearchResult[] | undefined
    if (opts.repos && opts.repos.length > 0) {
      try {
        const session = getActiveSession()
        repoResults = await multiRepoSearch(session, Array.from(textEmbedding) as number[], {
          repoIds: opts.repos,
          topK: opts.top,
          model: textProvider.model,
        })
      } catch {
        // non-fatal — mirrors CLI's warn-and-continue behavior
      }
    }

    async function runLevelPipeline(levelFlags: LevelFlags): Promise<SearchResult[]> {
      const levelSearchOpts: VectorSearchOptions = { ...searchOpts, ...levelFlags }
      let levelResults: SearchResult[]

      if (opts.hybrid) {
        levelResults = await hybridSearch(opts.query, textEmbedding, { ...levelSearchOpts, bm25Weight: opts.bm25Weight })
      } else if (dualModel && codeProvider && codeEmbedding) {
        const topKExtended = opts.top * 2
        const textResults = await vectorSearchWithAnn(textEmbedding, { ...levelSearchOpts, model: textProvider.model, topK: topKExtended, useVss: opts.vss })
        const codeResults = await vectorSearchWithAnn(codeEmbedding, { ...levelSearchOpts, model: codeProvider.model, topK: topKExtended, useVss: opts.vss })
        levelResults = mergeSearchResults(textResults, codeResults, opts.top)
      } else {
        levelResults = await vectorSearchWithAnn(textEmbedding, { ...levelSearchOpts, model: textProvider.model, useVss: opts.vss })
      }

      if (repoResults) {
        const combined = [...levelResults, ...repoResults]
        combined.sort((a, b) => b.score - a.score)
        levelResults = combined.slice(0, opts.top)
      }

      if (parsedBool && boolPartBEmbedding) {
        try {
          const resA = await vectorSearch(textEmbedding, { ...levelSearchOpts, topK: opts.top })
          const resB = await vectorSearch(boolPartBEmbedding, { ...levelSearchOpts, topK: opts.top })
          levelResults = parsedBool.op === 'OR' ? mergeOr(resA, resB, opts.top) : mergeAnd(resA, resB, opts.top)
        } catch {
          // fall back to precomputed results
        }
      }

      if (orEmbedding) {
        try {
          const orResults = await vectorSearch(orEmbedding, { ...levelSearchOpts, topK: opts.top })
          levelResults = mergeOr(levelResults, orResults, opts.top)
        } catch {
          // ignore
        }
      }
      if (andEmbedding) {
        try {
          const andResults = await vectorSearch(andEmbedding, { ...levelSearchOpts, topK: opts.top })
          levelResults = mergeAnd(levelResults, andResults, opts.top)
        } catch {
          // ignore
        }
      }

      if (opts.group) {
        levelResults = groupResults(levelResults, opts.group as GroupMode, opts.top)
      }

      if (opts.annotateClusters) {
        annotateClusters(levelResults)
      }

      return levelResults
    }

    const searchChunksFlag = opts.chunks || opts.level === 'chunk'
    const searchSymbolsFlag = opts.level === 'symbol'
    const searchModulesFlag = opts.level === 'module'
    const extraLevels = resolveExtraLevels(searchChunksFlag, searchSymbolsFlag, searchModulesFlag)
    const multiLevelActive = isMultiLevelActive(extraLevels)

    let results: SearchResult[] = []
    let resultsByLevel: Record<string, SearchResult[]> | undefined

    try {
      if (multiLevelActive && !opts.mergeLevels) {
        resultsByLevel = {}
        resultsByLevel.file = await runLevelPipeline({ searchChunks: false, searchSymbols: false, searchModules: false, includeFiles: true })
        for (const level of extraLevels) {
          resultsByLevel[level.name] = await runLevelPipeline(level.flags)
        }
      } else {
        results = await runLevelPipeline({ searchChunks: searchChunksFlag, searchSymbols: searchSymbolsFlag, searchModules: searchModulesFlag, includeFiles: true })
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
      return
    }

    const allResults: SearchResult[] = resultsByLevel ? Object.values(resultsByLevel).flat() : results

    if (opts.includeCommits) {
      const commitResults = await searchCommits(textEmbedding, { topK: opts.top, model: textProvider.model })
      if (opts.rendered) {
        const blobText = resultsByLevel ? renderResultsByLevel(resultsByLevel) : renderResults(results)
        const commitLines = commitResults.map((c) => `${c.score.toFixed(3)}  [commit ${c.commitHash.slice(0, 7)}]  ${c.paths[0] ?? ''}  ${c.message}`).join('\n')
        let text = blobText + (commitLines ? '\n\nCommit matches:\n' + commitLines : '')
        if (opts.explainLlm && allResults.length > 0) {
          text += '\n\n=== Provenance Citations (LLM Context) ===\n' + formatExplainForLlm(allResults, { includeSnippet: true })
        }
        res.type('text/plain').send(text)
        return
      }
      const payload: Record<string, unknown> = resultsByLevel
        ? { resultsByLevel, commitResults }
        : { blobResults: results, commitResults }
      res.json(payload)
      return
    }

    if (opts.rendered) {
      let text = resultsByLevel ? renderResultsByLevel(resultsByLevel) : renderResults(results)
      if (opts.explainLlm && allResults.length > 0) {
        text += '\n\n=== Provenance Citations (LLM Context) ===\n' + formatExplainForLlm(allResults, { includeSnippet: true })
      }
      res.type('text/plain').send(text)
      return
    }

    if (resultsByLevel) {
      res.json({ resultsByLevel })
      return
    }
    res.json(results)
  })

  router.post('/first-seen', async (req, res) => {
    const parsed = FirstSeenBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data

    const override: ModelOverrideParams = { model: opts.model, textModel: opts.textModel, codeModel: opts.codeModel }
    let textProvider: EmbeddingProvider
    try {
      textProvider = hasModelOverride(override) ? buildProviderForRequest(override, 'text') : defaultTextProvider
    } catch (err) {
      res.status(400).json({ error: `Model override failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    let queryEmbedding: Embedding
    try {
      queryEmbedding = await textProvider.embed(opts.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    let results: SearchResult[]
    if (opts.hybrid) {
      results = await hybridSearch(opts.query, queryEmbedding, { topK: opts.top, bm25Weight: opts.bm25Weight, branch: opts.branch })
    } else {
      results = await vectorSearchWithAnn(queryEmbedding, { topK: opts.top, branch: opts.branch, model: textProvider.model, useVss: opts.vss })
    }

    if (opts.repos && opts.repos.length > 0) {
      try {
        const session = getActiveSession()
        const repoResults = await multiRepoSearch(session, Array.from(queryEmbedding) as number[], {
          repoIds: opts.repos,
          topK: opts.top,
          model: textProvider.model,
        })
        const combined = [...results, ...repoResults]
        combined.sort((a, b) => b.score - a.score)
        results = combined.slice(0, opts.top)
      } catch {
        // non-fatal
      }
    }

    // Sort chronologically (first-seen semantics)
    const sorted = [...results].sort((a, b) => (a.firstSeen ?? 0) - (b.firstSeen ?? 0))

    if (opts.includeCommits) {
      const commitResults = await searchCommits(queryEmbedding, { topK: opts.top, model: textProvider.model })
      if (opts.rendered) {
        const blobText = renderFirstSeenResults(sorted, !opts.noHeadings)
        const commitLines = commitResults.map((c) => `${c.score.toFixed(3)}  [commit ${c.commitHash.slice(0, 7)}]  ${c.paths[0] ?? ''}  ${c.message}`).join('\n')
        res.type('text/plain').send(blobText + (commitLines ? '\n\nCommit matches:\n' + commitLines : ''))
        return
      }
      res.json({ blobResults: sorted, commitResults })
      return
    }

    if (opts.rendered) {
      res.type('text/plain').send(renderFirstSeenResults(sorted, !opts.noHeadings))
    } else {
      res.json(sorted)
    }
  })

  return router
}
