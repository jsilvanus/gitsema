import { z } from 'zod'
import { registerTool, serializeSearchResults } from '../registerTool.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { hybridSearch } from '../../core/search/hybridSearch.js'
import { searchCommits } from '../../core/search/commitSearch.js'
import { getTextProvider, getCodeProvider } from '../../core/embedding/providerFactory.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { groupResults, renderResults } from '../../core/search/ranking.js'
import { multiRepoSearch } from '../../core/indexing/repoRegistry.js'
import { getActiveSession } from '../../core/db/sqlite.js'

export function registerSearchTools(server) {
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
      level: z.enum(['file', 'chunk', 'symbol']).optional().default('file').describe('Search granularity level'),
      chunks: z.boolean().optional().default(false).describe('Include chunk-level embeddings'),
      include_commits: z.boolean().optional().default(false).describe('Also search commit messages'),
      group: z.enum(['file', 'module', 'commit']).optional().describe('Group results by mode'),
    },
    async ({ query, top_k, recent, alpha, before, after, hybrid, bm25_weight, branch, level, chunks, include_commits, group }, { embed }) => {
      const provider = getTextProvider()
      const qRes = await embed(provider, query, 'Error embedding query')
      if (!qRes.ok) return qRes.resp
      const queryEmbedding = qRes.embedding

      let beforeTs: number | undefined
      let afterTs: number | undefined
      try {
        if (before) beforeTs = parseDateArg(before)
        if (after) afterTs = parseDateArg(after)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error parsing date: ${msg}` }] }
      }

      let results = []
      if (hybrid) {
        const hybridResults = hybridSearch(query, queryEmbedding, { topK: top_k, bm25Weight: bm25_weight, branch })
        results = hybridResults
      } else {
        results = vectorSearch(queryEmbedding, {
          topK: top_k,
          recent,
          alpha,
          before: beforeTs,
          after: afterTs,
          searchChunks: level === 'chunk' || chunks,
          searchSymbols: level === 'symbol',
          branch,
          model: provider.model,
        })
      }

      let commitText = ''
      if (include_commits) {
        try {
          const commitResults = searchCommits(queryEmbedding, { topK: 10, model: provider.model })
          if (commitResults.length > 0) {
            commitText = '\n\nMatching commits:\n' + commitResults.map((c) => `${c.score.toFixed(3)}  ${c.paths[0] ?? '(unknown)'}  [${c.commitHash.slice(0, 7)}]  ${c.message}`).join('\n')
          }
        } catch (err) {
          // non-fatal
        }
      }

      if (group) {
        results = groupResults(results, group, top_k)
      }

      return { content: [{ type: 'text', text: renderResults(results) + commitText }] }
    },
  )

  // code_search
  registerTool(
    server,
    'code_search',
    'Search code using the code embedding model and return symbol/chunk level matches (default: symbol level)',
    {
      snippet: z.string().describe('Code snippet to embed and search for'),
      top_k: z.number().int().positive().optional().default(10).describe('Maximum number of results to return'),
      level: z.enum(['file', 'chunk', 'symbol']).optional().default('symbol').describe('Search granularity level'),
      branch: z.string().optional().describe('Restrict to blobs on this branch'),
    },
    async ({ snippet, top_k, level, branch }, { embed, serializeSearchResults }) => {
      const provider = getCodeProvider()
      const eRes = await embed(provider, snippet, 'Error embedding snippet')
      if (!eRes.ok) return eRes.resp
      const embedding = eRes.embedding

      const results = vectorSearch(embedding, {
        topK: top_k,
        searchChunks: level === 'chunk' || level === 'symbol',
        searchSymbols: level === 'symbol',
        branch,
        model: provider.model,
      })

      return { content: [{ type: 'text', text: serializeSearchResults(results) }] }
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
      const queryEmbedding = qRes.embedding

      let beforeTs: number | undefined
      let afterTs: number | undefined
      try {
        if (before) beforeTs = parseDateArg(before)
        if (after) afterTs = parseDateArg(after)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error parsing date: ${msg}` }] }
      }

      let results = vectorSearch(queryEmbedding, {
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
    },
    async ({ query, top_k, hybrid, bm25_weight, branch, level, chunks, include_commits }, { embed }) => {
      const provider = getTextProvider()
      const qRes = await embed(provider, query, 'Error embedding query')
      if (!qRes.ok) return qRes.resp
      const queryEmbedding = qRes.embedding

      let results
      if (hybrid) {
        const hybridResults = hybridSearch(query, queryEmbedding, { topK: top_k, bm25Weight: bm25_weight, branch })
        results = hybridResults
      } else {
        results = vectorSearch(queryEmbedding, { topK: top_k, searchChunks: level === 'chunk' || chunks, searchSymbols: level === 'symbol', branch })
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
          const commitResults = searchCommits(queryEmbedding, { topK: 10, model: provider.model })
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
      const embedding = eRes.embedding

      try {
        const session = getActiveSession()
        const results = await multiRepoSearch(session, embedding, { repoIds: repo_ids, topK: top_k, model })
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
