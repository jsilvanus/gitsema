import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTool, serializeSearchResults } from '../registerTool.js'
import { vectorSearch, vectorSearchWithAnn, mergeSearchResults, type VectorSearchOptions } from '../../core/search/analysis/vectorSearch.js'
import { hybridSearch } from '../../core/search/analysis/hybridSearch.js'
import { searchCommits } from '../../core/search/commitSearch.js'
import { getTextProvider, getCodeProvider, hasModelOverride, buildProviderForRequest, type ModelOverrideParams } from '../../core/embedding/providerFactory.js'
import { parseDateArg } from '../../core/search/temporal/timeSearch.js'
import { groupResults, renderResults, renderResultsByLevel } from '../../core/search/ranking.js'
import { parseBooleanQuery, mergeOr, mergeAnd } from '../../core/search/analysis/booleanSearch.js'
import { formatExplainForLlm } from '../../core/search/analysis/explainFormatter.js'
import { multiRepoSearch } from '../../core/indexing/repoRegistry.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import type { Embedding, SearchResult } from '../../core/models/types.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import {
  resolveExtraLevels,
  isMultiLevelActive,
  type LevelFlags,
} from '../../cli/commands/search.js'

export function registerSearchTools(server: McpServer) {
  // semantic_search
  registerTool(
    server,
    'semantic_search',
    "Semantically search the gitsema index for blobs matching the query string.",
    {
      query: z.string().describe('Natural-language query to embed and search for'),
      top_k: z.number().int().positive().optional().default(10).describe('Maximum number of results to return'),
      recent: z.boolean().optional().default(false).describe('Blend cosine similarity with a recency score'),
      alpha: z.number().min(0).max(1).optional().default(0.8).describe('Weight for cosine similarity in blended score (0–1)'),
      before: z.string().optional().describe('Only include blobs first seen before this date (YYYY-MM-DD)'),
      after: z.string().optional().describe('Only include blobs first seen after this date (YYYY-MM-DD)'),
      hybrid: z.boolean().optional().default(false).describe('Blend vector similarity with BM25 keyword matching'),
      bm25_weight: z.number().min(0).max(1).optional().default(0.3).describe('BM25 weight in hybrid score'),
      branch: z.string().optional().describe('Restrict results to blobs seen on this branch'),
      level: z.enum(['file', 'chunk', 'symbol', 'module']).optional().default('file').describe('Search granularity level'),
      merge_levels: z.boolean().optional().default(false).describe('Merge active search levels into one shared-cutoff ranked list instead of separate per-level lists (only relevant when 2+ of chunk/symbol/module are active)'),
      chunks: z.boolean().optional().default(false).describe('Include chunk-level embeddings'),
      include_commits: z.boolean().optional().default(false).describe('Also search commit messages'),
      group: z.enum(['file', 'module', 'commit']).optional().describe('Group results by mode'),
      // Phase 138: query-shaping flags restored to parity with CLI `search`.
      not_like: z.string().optional().describe('Negative example query — its similarity is subtracted from the score'),
      lambda: z.number().optional().default(0.5).describe('Weight for the negative example subtraction'),
      or: z.string().optional().describe('Combine results with another query via OR (union, max score)'),
      and: z.string().optional().describe('Combine results with another query via AND (intersection, harmonic mean)'),
      explain: z.boolean().optional().default(false).describe('Include per-result signal breakdown'),
      explain_llm: z.boolean().optional().default(false).describe('Append LLM-ready provenance citations for each result'),
      expand_query: z.boolean().optional().default(false).describe('Expand the query with top BM25 keywords before embedding (improves recall)'),
      annotate_clusters: z.boolean().optional().default(false).describe('Annotate each result with its cluster label (requires a prior clusters run)'),
      vss: z.boolean().optional().default(false).describe('Use the usearch HNSW ANN index for approximate search'),
      early_cut: z.number().int().positive().optional().describe('Limit the candidate pool to this many random samples (large indexes)'),
      no_cache: z.boolean().optional().default(false).describe('Skip the query embedding cache'),
      repos: z.array(z.string()).optional().describe('Repo IDs to include in a multi-repo search'),
      model: z.string().optional().describe('Embedding model override (applies to both text and code roles unless overridden below)'),
      text_model: z.string().optional().describe('Text-model override'),
      code_model: z.string().optional().describe('Code-model override'),
    },
    async (args, { embed }) => {
      const { query, top_k, recent, alpha, before, after, hybrid, bm25_weight, branch, level, merge_levels, chunks, include_commits, group,
        not_like, lambda, or: orQuery, and: andQuery, explain, explain_llm, expand_query, annotate_clusters, vss, early_cut, no_cache,
        repos, model, text_model, code_model } = args

      const override: ModelOverrideParams = { model, textModel: text_model, codeModel: code_model }
      let provider: EmbeddingProvider
      let codeProvider: EmbeddingProvider | undefined
      try {
        if (hasModelOverride(override)) {
          provider = buildProviderForRequest(override, 'text')
          codeProvider = buildProviderForRequest(override, 'code', false)
        } else {
          provider = getTextProvider()
          codeProvider = undefined
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error building provider: ${msg}` }] }
      }

      const qRes = await embed(provider, query, 'Error embedding query')
      if (!qRes.ok) return qRes.resp
      let queryEmbedding = qRes.embedding!

      let beforeTs: number | undefined
      let afterTs: number | undefined
      try {
        if (before) beforeTs = parseDateArg(before)
        if (after) afterTs = parseDateArg(after)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error parsing date: ${msg}` }] }
      }

      // Phase 52-equivalent: expand query with top BM25 keywords before re-embedding.
      if (expand_query) {
        try {
          const { rawDb } = getActiveSession()
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
              allTokens.push(...row.content.split(/\s+/).slice(0, 30))
            }
            const queryLower = query.toLowerCase()
            const expansion = [...new Set(allTokens)]
              .filter((t) => t.length > 2 && !queryLower.includes(t.toLowerCase()))
              .slice(0, 5)
            if (expansion.length > 0) {
              const expandedRes = await embed(provider, `${query} ${expansion.join(' ')}`, 'Error embedding expanded query')
              if (expandedRes.ok) queryEmbedding = expandedRes.embedding!
            }
          }
        } catch {
          // fall through with original embedding
        }
      }

      let negativeEmbedding: Embedding | undefined
      if (not_like) {
        const negRes = await embed(provider, not_like, 'Error embedding negative example')
        if (!negRes.ok) return negRes.resp
        negativeEmbedding = negRes.embedding!
      }

      let orEmbedding: Embedding | undefined
      if (orQuery) {
        const r = await embed(provider, orQuery, 'Error embedding OR query')
        if (r.ok) orEmbedding = r.embedding!
      }
      let andEmbedding: Embedding | undefined
      if (andQuery) {
        const r = await embed(provider, andQuery, 'Error embedding AND query')
        if (r.ok) andEmbedding = r.embedding!
      }

      const dualModel = !!codeProvider && codeProvider.model !== provider.model
      let codeEmbedding: Embedding | undefined
      if (dualModel && codeProvider) {
        const r = await embed(codeProvider, query, 'Error embedding query (code model)')
        if (r.ok) codeEmbedding = r.embedding!
      }

      const parsedBool = parseBooleanQuery(query)
      let boolPartBEmbedding: Embedding | undefined
      if (parsedBool) {
        const r = await embed(provider, parsedBool.parts[1], 'Error embedding boolean query part')
        if (r.ok) boolPartBEmbedding = r.embedding!
      }

      let repoResults: SearchResult[] | undefined
      if (repos && repos.length > 0) {
        try {
          const session = getActiveSession()
          repoResults = await multiRepoSearch(session, Array.from(queryEmbedding) as number[], { repoIds: repos, topK: top_k, model: provider.model })
        } catch {
          // non-fatal
        }
      }

      const baseSearchOpts: VectorSearchOptions = {
        topK: top_k,
        recent,
        alpha,
        before: beforeTs,
        after: afterTs,
        branch,
        query,
        negativeQueryEmbedding: negativeEmbedding,
        negativeLambda: negativeEmbedding ? lambda : undefined,
        explain,
        earlyCut: early_cut,
        noCache: no_cache,
      }

      async function runLevelPipeline(levelFlags: LevelFlags): Promise<SearchResult[]> {
        const levelSearchOpts: VectorSearchOptions = { ...baseSearchOpts, ...levelFlags }
        let levelResults: SearchResult[]
        if (hybrid) {
          levelResults = await hybridSearch(query, queryEmbedding, { ...levelSearchOpts, bm25Weight: bm25_weight })
        } else if (dualModel && codeProvider && codeEmbedding) {
          const topKExtended = top_k * 2
          const textResults = await vectorSearchWithAnn(queryEmbedding, { ...levelSearchOpts, model: provider.model, topK: topKExtended, useVss: vss })
          const codeResults = await vectorSearchWithAnn(codeEmbedding, { ...levelSearchOpts, model: codeProvider.model, topK: topKExtended, useVss: vss })
          levelResults = mergeSearchResults(textResults, codeResults, top_k)
        } else {
          levelResults = await vectorSearchWithAnn(queryEmbedding, { ...levelSearchOpts, model: provider.model, useVss: vss })
        }

        if (repoResults) {
          const combined = [...levelResults, ...repoResults]
          combined.sort((a, b) => b.score - a.score)
          levelResults = combined.slice(0, top_k)
        }

        if (parsedBool && boolPartBEmbedding) {
          try {
            const resA = await vectorSearch(queryEmbedding, { ...levelSearchOpts, topK: top_k })
            const resB = await vectorSearch(boolPartBEmbedding, { ...levelSearchOpts, topK: top_k })
            levelResults = parsedBool.op === 'OR' ? mergeOr(resA, resB, top_k) : mergeAnd(resA, resB, top_k)
          } catch {
            // fall back
          }
        }
        if (orEmbedding) {
          try {
            const orResults = await vectorSearch(orEmbedding, { ...levelSearchOpts, topK: top_k })
            levelResults = mergeOr(levelResults, orResults, top_k)
          } catch {
            // ignore
          }
        }
        if (andEmbedding) {
          try {
            const andResults = await vectorSearch(andEmbedding, { ...levelSearchOpts, topK: top_k })
            levelResults = mergeAnd(levelResults, andResults, top_k)
          } catch {
            // ignore
          }
        }

        if (group) {
          levelResults = groupResults(levelResults, group, top_k)
        }

        if (annotate_clusters && levelResults.length > 0) {
          try {
            const { rawDb } = getActiveSession()
            const hashes = levelResults.map((r) => `'${r.blobHash}'`).join(',')
            const rows = rawDb.prepare(
              `SELECT ca.blob_hash, bc.label FROM cluster_assignments ca
               JOIN blob_clusters bc ON bc.id = ca.cluster_id
               WHERE ca.blob_hash IN (${hashes})`,
            ).all() as Array<{ blob_hash: string; label: string }>
            const labelMap = new Map(rows.map((r) => [r.blob_hash, r.label]))
            for (const r of levelResults) {
              if (labelMap.has(r.blobHash)) r.clusterLabel = labelMap.get(r.blobHash)
            }
          } catch {
            // cluster_assignments table may not exist — silently skip
          }
        }

        return levelResults
      }

      const searchChunksFlag = level === 'chunk' || chunks
      const searchSymbolsFlag = level === 'symbol'
      const searchModulesFlag = level === 'module'
      const extraLevels = resolveExtraLevels(searchChunksFlag, searchSymbolsFlag, searchModulesFlag)
      const multiLevelActive = isMultiLevelActive(extraLevels)

      let results: SearchResult[] = []
      let resultsByLevel: Record<string, SearchResult[]> | undefined

      if (multiLevelActive && !merge_levels) {
        resultsByLevel = {}
        resultsByLevel.file = await runLevelPipeline({ searchChunks: false, searchSymbols: false, searchModules: false, includeFiles: true })
        for (const lvl of extraLevels) {
          resultsByLevel[lvl.name] = await runLevelPipeline(lvl.flags)
        }
      } else {
        results = await runLevelPipeline({ searchChunks: searchChunksFlag, searchSymbols: searchSymbolsFlag, searchModules: searchModulesFlag, includeFiles: true })
      }

      const allResults: SearchResult[] = resultsByLevel ? Object.values(resultsByLevel).flat() : results

      let commitText = ''
      if (include_commits) {
        try {
          const commitResults = await searchCommits(queryEmbedding, { topK: 10, model: provider.model })
          if (commitResults.length > 0) {
            commitText = '\n\nMatching commits:\n' + commitResults.map((c) => `${c.score.toFixed(3)}  ${c.paths[0] ?? '(unknown)'}  [${c.commitHash.slice(0, 7)}]  ${c.message}`).join('\n')
          }
        } catch (err) {
          // non-fatal
        }
      }

      let text = resultsByLevel ? renderResultsByLevel(resultsByLevel) : renderResults(results)
      text += commitText
      if (explain_llm && allResults.length > 0) {
        text += '\n\n=== Provenance Citations (LLM Context) ===\n' + formatExplainForLlm(allResults, { includeSnippet: true })
      }

      return { content: [{ type: 'text', text }] }
    },
  )

  // code_search
  registerTool(
    server,
    'code_search',
    'Search code using the code embedding model and return symbol/chunk level matches (default: symbol level). When the chunk and symbol pools are both active (the default), results are returned as a `results_by_level` object with separate, independently-ranked lists per level instead of one merged list — pass merge_levels to opt back into a single flat results array.',
    {
      snippet: z.string().describe('Code snippet to embed and search for'),
      top_k: z.number().int().positive().optional().default(10).describe('Maximum number of results to return'),
      level: z.enum(['file', 'chunk', 'symbol']).optional().default('symbol').describe('Search granularity level'),
      branch: z.string().optional().describe('Restrict to blobs on this branch'),
      merge_levels: z.boolean().optional().default(false).describe('Merge the chunk/symbol pools into one shared-cutoff results array instead of separate per-level results_by_level lists'),
    },
    async ({ snippet, top_k, level, branch, merge_levels }, { embed }) => {
      const provider = getCodeProvider()
      const eRes = await embed(provider, snippet, 'Error embedding snippet')
      if (!eRes.ok) return eRes.resp
      const embedding = eRes.embedding!

      const searchChunksFlag = level === 'chunk' || level === 'symbol'
      const searchSymbolsFlag = level === 'symbol'
      const baseOpts = { topK: top_k, branch, model: provider.model }

      // Phase 137: isolate the chunk vs. symbol candidate pools by default —
      // see codeSearchCommand()/resolveExtraLevels() in src/cli/commands/
      // search.ts and codeSearch.ts for the shared mechanism/rationale.
      const extraLevels = resolveExtraLevels(searchChunksFlag, searchSymbolsFlag, false)
      const multiLevelActive = isMultiLevelActive(extraLevels)

      const project = (results: SearchResult[]) => results.map((r) => ({ paths: r.paths, score: r.score, blobHash: r.blobHash, kind: r.kind }))

      if (multiLevelActive && !merge_levels) {
        const resultsByLevel: Record<string, ReturnType<typeof project>> = {}
        const fileResults = await vectorSearch(embedding, { ...baseOpts, searchChunks: false, searchSymbols: false, includeFiles: true })
        resultsByLevel.file = project(fileResults)
        for (const lvl of extraLevels) {
          const levelResults = await vectorSearch(embedding, { ...baseOpts, ...lvl.flags })
          resultsByLevel[lvl.name] = project(levelResults)
        }
        return { content: [{ type: 'text', text: JSON.stringify({ snippet, results_by_level: resultsByLevel }, null, 2) }] }
      }

      const results = await vectorSearch(embedding, {
        ...baseOpts,
        searchChunks: searchChunksFlag,
        searchSymbols: searchSymbolsFlag,
        includeFiles: true,
      })

      return { content: [{ type: 'text', text: JSON.stringify({ snippet, results: project(results) }, null, 2) }] }
    },
  )

  // search_history
  registerTool(
    server,
    'search_history',
    'Search for semantically similar blobs and return results enriched with Git history (first-seen date, commit hash). Results are sorted by semantic score.',
    {
      query: z.string().describe('Natural-language query to embed and search for'),
      top_k: z.number().int().positive().optional().default(10).describe('Maximum number of results to return'),
      before: z.string().optional().describe('Only include blobs first seen before this date (YYYY-MM-DD)'),
      after: z.string().optional().describe('Only include blobs first seen after this date (YYYY-MM-DD)'),
      sort_by_date: z.boolean().optional().default(false).describe('Sort results by first-seen date (ascending) instead of score'),
      branch: z.string().optional().describe('Restrict results to blobs seen on this branch'),
    },
    async ({ query, top_k, before, after, sort_by_date, branch }, { embed, serializeSearchResults }) => {
      const provider = getTextProvider()
      const qRes = await embed(provider, query, 'Error embedding query')
      if (!qRes.ok) return qRes.resp
      const queryEmbedding = qRes.embedding!

      let beforeTs: number | undefined
      let afterTs: number | undefined
      try {
        if (before) beforeTs = parseDateArg(before)
        if (after) afterTs = parseDateArg(after)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error parsing date: ${msg}` }] }
      }

      let results = await vectorSearch(queryEmbedding, {
        topK: top_k,
        before: beforeTs,
        after: afterTs,
        branch,
      })

      if (sort_by_date) {
        results = [...results].sort((a, b) => {
          if (a.firstSeen === undefined && b.firstSeen === undefined) return 0
          if (a.firstSeen === undefined) return 1
          if (b.firstSeen === undefined) return -1
          return a.firstSeen - b.firstSeen
        })
      }

      return { content: [{ type: 'text', text: serializeSearchResults(results) }] }
    },
  )

  // first_seen
  registerTool(
    server,
    'first_seen',
    'Find when a concept first appeared in the codebase by searching semantically and then sorting results by first-seen date (earliest first).',
    {
      query: z.string().describe('Natural-language query describing the concept to search for'),
      top_k: z.number().int().positive().optional().default(10).describe('Maximum number of results to return'),
      hybrid: z.boolean().optional().default(false).describe('blend vector similarity with BM25 keyword matching'),
      bm25_weight: z.number().min(0).max(1).optional().default(0.3).describe('BM25 weight in hybrid score'),
      branch: z.string().optional().describe('Restrict results to blobs seen on this branch'),
      level: z.enum(['file', 'chunk', 'symbol']).optional().default('file').describe('Search granularity level'),
      chunks: z.boolean().optional().default(false).describe('Include chunk-level embeddings'),
      include_commits: z.boolean().optional().default(false).describe('Also search commit messages and show chronological commit results'),
      // Phase 138: parity flags.
      vss: z.boolean().optional().default(false).describe('Use the usearch HNSW ANN index for approximate search'),
      repos: z.array(z.string()).optional().describe('Repo IDs to include in a multi-repo search'),
      model: z.string().optional().describe('Embedding model override'),
      text_model: z.string().optional().describe('Text-model override'),
      code_model: z.string().optional().describe('Code-model override (unused unless a future dual-model path needs it)'),
    },
    async ({ query, top_k, hybrid, bm25_weight, branch, level, chunks, include_commits, vss, repos, model, text_model, code_model }, { embed }) => {
      const override: ModelOverrideParams = { model, textModel: text_model, codeModel: code_model }
      let provider: EmbeddingProvider
      try {
        provider = hasModelOverride(override) ? buildProviderForRequest(override, 'text') : getTextProvider()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error building provider: ${msg}` }] }
      }

      const qRes = await embed(provider, query, 'Error embedding query')
      if (!qRes.ok) return qRes.resp
      const queryEmbedding = qRes.embedding!

      let results: SearchResult[]
      if (hybrid) {
        results = await hybridSearch(query, queryEmbedding, { topK: top_k, bm25Weight: bm25_weight, branch })
      } else {
        results = await vectorSearchWithAnn(queryEmbedding, { topK: top_k, searchChunks: level === 'chunk' || chunks, searchSymbols: level === 'symbol', branch, model: provider.model, useVss: vss })
      }

      if (repos && repos.length > 0) {
        try {
          const session = getActiveSession()
          const repoResults = await multiRepoSearch(session, Array.from(queryEmbedding) as number[], { repoIds: repos, topK: top_k, model: provider.model })
          const combined = [...results, ...repoResults]
          combined.sort((a, b) => b.score - a.score)
          results = combined.slice(0, top_k)
        } catch {
          // non-fatal
        }
      }

      const sorted = [...results].sort((a, b) => {
        if (a.firstSeen === undefined && b.firstSeen === undefined) return 0
        if (a.firstSeen === undefined) return 1
        if (b.firstSeen === undefined) return -1
        return a.firstSeen - b.firstSeen
      })

      if (sorted.length === 0) return { content: [{ type: 'text', text: '(no results)' }] }

      const lines = sorted.map((r) => {
        const hash = r.blobHash.slice(0, 7)
        const path = r.paths[0] ?? '(unknown path)'
        const score = r.score.toFixed(3)
        const date = r.firstSeen !== undefined ? new Date(r.firstSeen * 1000).toISOString().slice(0, 10) : '(unknown)'
        return `${date}  ${path.padEnd(50)}  [${hash}]  (score: ${score})`
      })

      let commitText = ''
      if (include_commits) {
        try {
          const commitResults = await searchCommits(queryEmbedding, { topK: 10, model: provider.model })
          if (commitResults.length > 0) {
            commitText = '\n\nMatching commits:\n' + commitResults.map((c) => `${c.score.toFixed(3)}  ${c.paths[0] ?? '(unknown)'}  [${c.commitHash.slice(0, 7)}]  ${c.message}`).join('\n')
          }
        } catch (err) {
          // non-fatal
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') + commitText }] }
    },
  )

  // multi_repo_search
  registerTool(
    server,
    'multi_repo_search',
    'Search across multiple registered gitsema repos. Each repo must have a db_path registered via `gitsema repos add`.',
    {
      query: z.string().describe('Natural-language query'),
      repo_ids: z.array(z.string()).optional().describe('Repo IDs to search (default: all registered repos with db_path)'),
      top_k: z.number().int().positive().optional().default(10).describe('Max results'),
      model: z.string().optional().describe('Embedding model override'),
    },
    async ({ query, repo_ids, top_k, model }, { embed }) => {
      const provider = getTextProvider()
      const eRes = await embed(provider, query, 'Error embedding query')
      if (!eRes.ok) return eRes.resp
      const embedding = eRes.embedding!

      try {
        const session = getActiveSession()
        const results = await multiRepoSearch(session, Array.from(embedding), { repoIds: repo_ids, topK: top_k, model })
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found across registered repos.' }] }
        }
        const lines = results.map((r) => `[${r.repoId}] ${r.score.toFixed(3)}  ${r.paths?.[0] ?? r.blobHash.slice(0, 8)}`)
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )
}
