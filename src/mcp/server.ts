/**
 * gitsema MCP server (Phase 11)
 *
 * Exposes the core gitsema search and analysis capabilities as MCP tools
 * so that Claude Code and other MCP clients can query the semantic index.
 *
 * Tools:
 *   semantic_search  — vector similarity search over the indexed blobs
 *   search_history   — same as semantic_search with temporal ordering / filtering
 *   first_seen       — find when a concept first appeared in the codebase
 *   evolution        — semantic drift timeline for a specific file path
 *   index            — index (or incrementally re-index) the current Git repo
 *
 * Transport: stdio (JSON-RPC over stdin/stdout).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { vectorSearch } from '../core/search/vectorSearch.js'
import { computeEvolution, computeConceptEvolution } from '../core/search/evolution.js'
import { computeSemanticDiff } from '../core/search/semanticDiff.js'
import { computeSemanticBlame } from '../core/search/semanticBlame.js'
import { runIndex } from '../core/indexing/indexer.js'
import { getBlobContent } from '../core/indexing/blobStore.js'
import { buildProvider, getTextProvider, getCodeProvider } from '../core/embedding/providerFactory.js'
import { embedQuery } from '../core/embedding/embedQuery.js'
import type { SearchResult, Embedding } from '../core/models/types.js'
import { formatDate, groupResults, renderResults, renderFirstSeenResults } from '../core/search/ranking.js'
import { parseDateArg } from '../core/search/timeSearch.js'
import { DEFAULT_MAX_SIZE } from '../core/git/showBlob.js'
import { getMergeBase, getBranchExclusiveBlobs } from '../core/git/branchDiff.js'
import { computeSemanticCollisions, computeMergeImpact } from '../core/search/mergeAudit.js'
import { computeBranchSummary } from '../core/search/branchSummary.js'
import { computeClusters, computeClusterSnapshot, compareClusterSnapshots, computeClusterTimeline, resolveRefToTimestamp, getBlobHashesUpTo } from '../core/search/clustering.js'
import { computeConceptChangePoints, computeFileChangePoints } from '../core/search/changePoints.js'
import { computeAuthorContributions } from '../core/search/authorSearch.js'
import { computeImpact } from '../core/search/impact.js'
import { findDeadConcepts } from '../core/search/deadConcepts.js'
import { hybridSearch } from '../core/search/hybridSearch.js'
import { searchCommits } from '../core/search/commitSearch.js'
import { scanForVulnerabilities } from '../core/search/securityScan.js'
import { computeHealthTimeline } from '../core/search/healthTimeline.js'
import { scoreDebt } from '../core/search/debtScoring.js'
import { getActiveSession } from '../core/db/sqlite.js'

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Result serialization helpers
// ---------------------------------------------------------------------------

function serializeSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return '(no results)'
  return results
    .map((r) => {
      const hash = r.blobHash.slice(0, 7)
      const path = r.paths[0] ?? '(unknown path)'
      const score = r.score.toFixed(3)
      const date = r.firstSeen !== undefined ? `  first: ${formatDate(r.firstSeen)}` : ''
      return `${score}  ${path.padEnd(50)}  [${hash}]${date}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// MCP server setup
// ---------------------------------------------------------------------------

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'gitsema',
    version: '0.0.1',
  })

  // -------------------------------------------------------------------------
  // Tool: semantic_search
  // -------------------------------------------------------------------------
  server.tool(
    'semantic_search',
    'Semantically search the gitsema index for blobs matching the query string.',
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
    async ({ query, top_k, recent, alpha, before, after, hybrid, bm25_weight, branch, level, chunks, include_commits, group }) => {
      const provider = getTextProvider()
      let queryEmbedding: Embedding
      try {
        queryEmbedding = await embedQuery(provider, query)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error embedding query: ${msg}` }] }
      }

      let beforeTs: number | undefined
      let afterTs: number | undefined
      try {
        if (before) beforeTs = parseDateArg(before)
        if (after) afterTs = parseDateArg(after)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error parsing date: ${msg}` }] }
      }

      // If hybrid requested, use hybridSearch to obtain candidate set and scores
      let results: SearchResult[] = []
      if (hybrid) {
        const hybridResults = hybridSearch(query, queryEmbedding, { topK: top_k, bm25Weight: bm25_weight, branch })
        // hybridResults shape is similar to SearchResult but may be limited; map to SearchResult-compatible objects
        results = hybridResults
      } else {
        // Use vector search
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

      // Optionally include commit search results
      let commitText = ''
      if (include_commits) {
        try {
          const commitResults = searchCommits(queryEmbedding, { topK: 10, model: provider.model })
          if (commitResults.length > 0) {
            commitText = '\n\nMatching commits:\n' + commitResults.map((c) => `${c.score.toFixed(3)}  ${c.paths[0] ?? '(unknown)'}  [${c.commitHash.slice(0, 7)}]  ${c.message}`).join('\n')
          }
        } catch (err) {
          // Non-fatal — proceed without commit results
        }
      }

      // Apply grouping if requested
      if (group) {
        results = groupResults(results, group, top_k)
      }

      return { content: [{ type: 'text', text: renderResults(results) + commitText }] }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: code_search (P3-1)
  // -------------------------------------------------------------------------
  server.tool(
    'code_search',
    'Search code using the code embedding model and return symbol/chunk level matches (default: symbol level)',
    {
      snippet: z.string().describe('Code snippet to embed and search for'),
      top_k: z.number().int().positive().optional().default(10).describe('Maximum number of results to return'),
      level: z.enum(['file', 'chunk', 'symbol']).optional().default('symbol').describe('Search granularity level'),
      branch: z.string().optional().describe('Restrict to blobs on this branch'),
    },
    async ({ snippet, top_k, level, branch }) => {
      const provider = getCodeProvider()
      let embedding: Embedding
      try {
        embedding = await embedQuery(provider, snippet)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error embedding snippet: ${msg}` }] }
      }

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

  // -------------------------------------------------------------------------
  // Tool: search_history
  // -------------------------------------------------------------------------
  server.tool(
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
    async ({ query, top_k, before, after, sort_by_date, branch }) => {
      const provider = getTextProvider()
      let queryEmbedding: Embedding
      try {
        queryEmbedding = await embedQuery(provider, query)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error embedding query: ${msg}` }] }
      }

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

  // -------------------------------------------------------------------------
  // Tool: first_seen
  // -------------------------------------------------------------------------
  server.tool(
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
    async ({ query, top_k, hybrid, bm25_weight, branch, level, chunks, include_commits }) => {
      const provider = getTextProvider()
      let queryEmbedding: Embedding
      try {
        queryEmbedding = await embedQuery(provider, query)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error embedding query: ${msg}` }] }
      }

      let results: SearchResult[]
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
        const date = r.firstSeen !== undefined ? formatDate(r.firstSeen) : '(unknown)'
        return `${date}  ${path.padEnd(50)}  [${hash}]  (score: ${score})`
      })

      // Optionally include commit search results
      let commitText = ''
      if (include_commits) {
        try {
          const commitResults = searchCommits(queryEmbedding, { topK: 10, model: provider.model })
          if (commitResults.length > 0) {
            commitText = '\n\nMatching commits:\n' + commitResults.map((c) => `${c.score.toFixed(3)}  ${c.paths[0] ?? '(unknown)'}  [${c.commitHash.slice(0, 7)}]  ${c.message}`).join('\n')
          }
        } catch (err) {
          // Non-fatal
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') + commitText }] }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: evolution
  // -------------------------------------------------------------------------
  server.tool(
    'evolution',
    'Track how a file\'s semantic content has drifted over time. Returns a human-readable timeline by default, or a structured JSON dump when structured=true.',
    {
      path: z.string().describe('File path relative to the repo root, e.g. "src/auth/oauth.ts"'),
      threshold: z.number().min(0).max(2).optional().default(0.3).describe('Cosine distance threshold above which a version is flagged as a large change'),
      structured: z.boolean().optional().default(false).describe('Return structured JSON with full timeline data instead of human-readable text (useful for agent processing)'),
      include_content: z.boolean().optional().default(false).describe('Include the stored file content for each version in the structured output (only used when structured=true)'),
    },
    async ({ path, threshold, structured, include_content }) => {
      const entries = computeEvolution(path)

      if (entries.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No history found for: ${path}\nHas this file been indexed? Run the index tool or \`gitsema index\` first.`,
            },
          ],
        }
      }

      if (structured) {
        // Return machine-readable JSON for agent consumption
        const data = {
          path,
          versions: entries.length,
          threshold,
          timeline: entries.map((e, i) => {
            const entry: Record<string, unknown> = {
              index: i,
              date: formatDate(e.timestamp),
              timestamp: e.timestamp,
              blobHash: e.blobHash,
              commitHash: e.commitHash,
              distFromPrev: e.distFromPrev,
              distFromOrigin: e.distFromOrigin,
              isOrigin: i === 0,
              isLargeChange: i > 0 && e.distFromPrev >= threshold,
            }
            if (include_content) {
              entry.content = getBlobContent(e.blobHash) ?? null
            }
            return entry
          }),
          summary: {
            largeChanges: entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length,
            maxDistFromPrev: Math.max(...entries.map((e) => e.distFromPrev), 0),
            totalDrift: entries[entries.length - 1].distFromOrigin,
          },
        }
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      }

      // Human-readable output
      const lines = entries.map((e, i) => {
        const date = formatDate(e.timestamp)
        const blob = e.blobHash.slice(0, 7)
        const commit = e.commitHash.slice(0, 7)
        const dPrev = e.distFromPrev.toFixed(4)
        const dOrigin = e.distFromOrigin.toFixed(4)
        const note = i === 0 ? '  (origin)' : e.distFromPrev >= threshold ? '  ← large change' : ''
        return `${date}  blob:${blob}  commit:${commit}  dist_prev=${dPrev}  dist_origin=${dOrigin}${note}`
      })

      return {
        content: [{ type: 'text', text: `Evolution of ${path}:\n\n${lines.join('\n')}` }],
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: concept_evolution
  // -------------------------------------------------------------------------
  server.tool(
    'concept_evolution',
    'Show how a semantic concept (e.g. "authentication") has evolved across the commit history. Embeds the query, finds the top-matching blobs, sorts them chronologically, and computes the cosine distance between consecutive timeline entries to reveal how the related code changed over time.',
    {
      query: z.string().describe('Natural-language concept to trace, e.g. "authentication" or "error handling"'),
      top_k: z.number().int().positive().optional().default(50).describe('Number of top-matching blobs to include in the timeline'),
      threshold: z.number().min(0).max(2).optional().default(0.3).describe('Cosine distance threshold above which a step is flagged as a large change'),
      structured: z.boolean().optional().default(false).describe('Return structured JSON instead of human-readable text (useful for agent processing)'),
      include_content: z.boolean().optional().default(false).describe('Include stored file content for each entry in the structured output (only used when structured=true)'),
    },
    async ({ query, top_k, threshold, structured, include_content }) => {
      const provider = getTextProvider()
      let queryEmbedding: Embedding
      try {
        queryEmbedding = await embedQuery(provider, query)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error embedding query: ${msg}` }] }
      }

      const entries = computeConceptEvolution(queryEmbedding, top_k)

      if (entries.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No matching blobs found for: "${query}"\nHas the index been built? Run the index tool or \`gitsema index\` first.`,
            },
          ],
        }
      }

      if (structured) {
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
            if (include_content) {
              item.content = getBlobContent(e.blobHash) ?? null
            }
            return item
          }),
          summary: {
            largeChanges: entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length,
            maxDistFromPrev: Math.max(...entries.map((e) => e.distFromPrev), 0),
            avgScore: entries.reduce((sum, e) => sum + e.score, 0) / entries.length,
          },
        }
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      }

      // Human-readable output
      const lines = entries.map((e, i) => {
        const date = formatDate(e.timestamp)
        const path = (e.paths[0] ?? '(unknown path)').padEnd(50)
        const blob = e.blobHash.slice(0, 7)
        const score = e.score.toFixed(3)
        const dPrev = e.distFromPrev.toFixed(4)
        const note = i === 0 ? '  (origin)' : e.distFromPrev >= threshold ? '  ← large change' : ''
        return `${date}  ${path}  [${blob}]  score=${score}  dist_prev=${dPrev}${note}`
      })

      return {
        content: [
          {
            type: 'text',
            text: `Concept evolution: "${query}"\nEntries found: ${entries.length}\n\n${lines.join('\n')}`,
          },
        ],
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: index
  // -------------------------------------------------------------------------
  server.tool(
    'index',
    'Index (or incrementally re-index) the Git repository at the current working directory. Returns a summary of blobs indexed, skipped, and any failures.',
    {
      since: z.string().optional().describe('Only index commits after this point; accepts a date (2024-01-01), tag (v1.0), commit hash, or "all" to force a full re-index'),
      concurrency: z.number().int().positive().optional().default(4).describe('Number of blobs to embed concurrently'),
      ext: z.string().optional().describe('Comma-separated list of file extensions to index, e.g. ".ts,.js,.py"'),
      exclude: z.string().optional().describe('Comma-separated list of path patterns to skip, e.g. "node_modules,dist,vendor"'),
      max_size: z.string().optional().describe('Skip blobs larger than this size, e.g. "200kb" or "1mb"'),
    },
    async ({ since, concurrency, ext, exclude, max_size }) => {
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const codeModelName = process.env.GITSEMA_CODE_MODEL ?? textModel
      let textProvider
      let codeProvider
      try {
        textProvider = buildProvider(providerType, textModel)
        codeProvider = codeModelName !== textModel ? buildProvider(providerType, codeModelName) : undefined
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }

      // Parse max_size (simple: accept bytes or kb/mb suffixes)
      let maxBlobSize = DEFAULT_MAX_SIZE
      if (max_size) {
        const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(max_size.trim())
        if (!m) {
          return { content: [{ type: 'text', text: `Error: invalid max_size "${max_size}". Expected e.g. "200kb" or "1mb".` }] }
        }
        const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }
        maxBlobSize = Math.round(parseFloat(m[1]) * (multipliers[(m[2] ?? 'b').toLowerCase()] ?? 1))
      }

      const extFilter = ext
        ? ext.split(',').map((e: string) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
        : undefined
      const excludeFilter = exclude
        ? exclude.split(',').map((e: string) => e.trim()).filter(Boolean)
        : undefined

      try {
        const stats = await runIndex({
          repoPath: '.',
          provider: textProvider,
          codeProvider,
          since,
          concurrency,
          maxBlobSize,
          filter: { ext: extFilter, exclude: excludeFilter },
        })

        const lines = [
          `Indexing complete in ${stats.elapsed}ms`,
          `  Blobs seen:        ${stats.seen}`,
          `  Newly indexed:     ${stats.indexed}`,
          `  Already in DB:     ${stats.skipped}`,
          `  Oversized:         ${stats.oversized}`,
          `  Filtered out:      ${stats.filtered}`,
          `  Failed:            ${stats.failed}`,
          `  Commits mapped:    ${stats.commits}`,
          `  Blob-commit links: ${stats.blobCommits}`,
        ]
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error during indexing: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: branch_summary
  // -------------------------------------------------------------------------
  server.tool(
    'branch_summary',
    'Generate a semantic summary of what a branch is about compared to its base branch. Shows the nearest concept clusters and the files with the highest semantic drift.',
    {
      branch: z.string().describe('Branch to summarise (short name, e.g. "feature/auth")'),
      base_branch: z.string().optional().default('main').describe('Base branch to compare against (default "main")'),
      top_concepts: z.number().int().positive().optional().default(5).describe('Number of nearest concept clusters to return'),
    },
    async ({ branch, base_branch, top_concepts }) => {
      try {
        const result = await computeBranchSummary(branch, base_branch, { topConcepts: top_concepts })

        if (result.exclusiveBlobCount === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Branch "${branch}" has no exclusive blobs compared to "${base_branch}" (merge base: ${result.mergeBase.slice(0, 8)}).\nEnsure the branch is indexed with the index tool first.`,
              },
            ],
          }
        }

        const lines = [
          `Branch summary: ${result.branch} vs ${result.baseBranch}`,
          `Merge base: ${result.mergeBase.slice(0, 8)}`,
          `Exclusive blobs: ${result.exclusiveBlobCount}`,
          '',
        ]

        if (result.nearestConcepts.length > 0) {
          lines.push('This branch is semantically about:')
          for (const [i, c] of result.nearestConcepts.entries()) {
            lines.push(`  ${i + 1}. "${c.clusterLabel}"  (similarity: ${c.similarity.toFixed(3)})`)
          }
          lines.push('')
        } else {
          lines.push('No concept clusters available. Run gitsema clusters first.')
          lines.push('')
        }

        if (result.topChangedPaths.length > 0) {
          lines.push('Top semantically-drifted files:')
          for (const entry of result.topChangedPaths) {
            lines.push(`  ${entry.path}  (drift: ${entry.semanticDrift.toFixed(3)})`)
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: merge_audit
  // -------------------------------------------------------------------------
  server.tool(
    'merge_audit',
    'Detect semantic collisions between two branches — pairs of files that are about the same concept even if they don\'t share lines. Returns collision pairs and a centroid-level branch overlap score.',
    {
      branch_a: z.string().describe('First branch name (e.g. "feature/auth")'),
      branch_b: z.string().describe('Second branch name (e.g. "feature/payments")'),
      base_commit: z.string().optional().describe('Override merge-base detection with this commit hash or ref'),
      threshold: z.number().min(0).max(1).optional().default(0.85).describe('Cosine similarity threshold for a collision (0–1, default 0.85)'),
      top_k: z.number().int().positive().optional().default(20).describe('Maximum collision pairs to return'),
    },
    async ({ branch_a, branch_b, base_commit, threshold, top_k }) => {
      try {
        let mergeBase: string
        if (base_commit) {
          mergeBase = base_commit
        } else {
          mergeBase = getMergeBase(branch_a, branch_b)
        }

        const blobsA = getBranchExclusiveBlobs(branch_a, mergeBase)
        const blobsB = getBranchExclusiveBlobs(branch_b, mergeBase)

        const report = computeSemanticCollisions(blobsA, blobsB, branch_a, branch_b, mergeBase, {
          threshold,
          topK: top_k,
        })

        const lines = [
          `Merge audit: ${report.branchA} ↔ ${report.branchB}`,
          `Merge base: ${report.mergeBase.slice(0, 8)}`,
          `Branch A exclusive blobs: ${report.blobCountA}`,
          `Branch B exclusive blobs: ${report.blobCountB}`,
          `Centroid similarity: ${report.centroidSimilarity >= 0 ? report.centroidSimilarity.toFixed(3) : 'n/a'}`,
          `Collisions found: ${report.collisionPairs.length}`,
          '',
        ]

        if (report.collisionZones.length > 0) {
          lines.push('Collision zones:')
          for (const z of report.collisionZones) {
            lines.push(`  "${z.clusterLabel}" — ${z.pairCount} pair(s)`)
          }
          lines.push('')
        }

        if (report.collisionPairs.length > 0) {
          lines.push('Top collision pairs:')
          for (const pair of report.collisionPairs.slice(0, 10)) {
            const pathA = pair.blobA.paths[0] ?? pair.blobA.hash.slice(0, 7)
            const pathB = pair.blobB.paths[0] ?? pair.blobB.hash.slice(0, 7)
            lines.push(`  ${pair.similarity.toFixed(3)}  ${pathA}  ↔  ${pathB}`)
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: merge_preview
  // -------------------------------------------------------------------------
  server.tool(
    'merge_preview',
    'Predict how the semantic concept landscape will shift after merging a branch. Returns the same cluster diff report as cluster-diff but driven by branch-exclusive blobs rather than timestamps.',
    {
      branch: z.string().describe('Branch to merge (e.g. "feature/auth")'),
      into: z.string().optional().default('main').describe('Target branch to merge into (default "main")'),
      k: z.number().int().positive().optional().default(8).describe('Number of semantic clusters to compute'),
    },
    async ({ branch, into, k }) => {
      try {
        const report = await computeMergeImpact(branch, into, { k })

        const lines = [
          `Merge preview: ${branch} → ${into}`,
          `Base blobs: ${report.before.totalBlobs}  |  Post-merge blobs: ${report.after.totalBlobs}`,
          `Changes: ${report.newBlobsTotal} new, ${report.removedBlobsTotal} removed, ${report.movedBlobsTotal} moved, ${report.stableBlobsTotal} stable`,
          '',
          'Predicted cluster changes:',
        ]

        for (const change of report.changes) {
          const after = change.afterCluster
          const before = change.beforeCluster
          if (after !== null && before !== null) {
            lines.push(
              `  "${after.label}"  drift: ${change.centroidDrift.toFixed(3)}  new: ${change.newBlobs}  stable: ${change.stable}`,
            )
          } else if (after !== null) {
            lines.push(`  "${after.label}"  [NEW]  ${after.size} blobs`)
          } else if (before !== null) {
            lines.push(`  "${before.label}"  [DISSOLVED]`)
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: clusters
  // -------------------------------------------------------------------------
  server.tool(
    'clusters',
    'Cluster all indexed blobs into K semantic groups using k-means and return the cluster labels, sizes, and representative file paths.',
    {
      k: z.number().int().positive().optional().default(8).describe('Number of clusters to compute'),
      top_keywords: z.number().int().positive().optional().default(5).describe('Number of keywords per cluster label'),
      enhanced_labels: z.boolean().optional().default(false).describe('Use TF-IDF enhanced cluster labels'),
      branch: z.string().optional().describe('Restrict clustering to blobs seen on this branch'),
    },
    async ({ k, top_keywords, enhanced_labels, branch }) => {
      try {
        let blobHashFilter: string[] | undefined
        if (branch) {
          const { getBlobHashesOnBranch } = await import('../core/search/clustering.js')
          blobHashFilter = getBlobHashesOnBranch(branch)
        }
        const report = await computeClusters({ k, topKeywords: top_keywords, useEnhancedLabels: enhanced_labels, blobHashFilter })
        const lines = [
          `Clusters: ${report.k}  |  Total blobs: ${report.totalBlobs}`,
          '',
        ]
        for (const c of report.clusters) {
          const kws = enhanced_labels && c.enhancedKeywords.length > 0 ? c.enhancedKeywords : c.topKeywords
          lines.push(`  [${c.id}] ${c.label}  (${c.size} blobs)  keywords: ${kws.join(', ')}`)
          lines.push(`       paths: ${c.representativePaths.slice(0, 3).join(', ')}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: change_points
  // -------------------------------------------------------------------------
  server.tool(
    'change_points',
    'Find the historical moments when a semantic concept underwent its largest shifts across the codebase.',
    {
      query: z.string().describe('Natural-language concept to track'),
      top_k: z.number().int().positive().optional().default(50).describe('Number of top-matching blobs to scan'),
      threshold: z.number().min(0).max(2).optional().default(0.3).describe('Cosine distance threshold for flagging a change point'),
      top_points: z.number().int().positive().optional().default(5).describe('Number of change points to return'),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ query, top_k, threshold, top_points, branch }) => {
      try {
        const provider = getTextProvider()
        const queryEmbedding = await embedQuery(provider, query)
        const report = computeConceptChangePoints(query, queryEmbedding, { topK: top_k, threshold, topPoints: top_points, branch })
        if (report.points.length === 0) {
          return { content: [{ type: 'text', text: 'No change points found above threshold.' }] }
        }
        const lines = [`Change points for: "${query}"  (threshold: ${threshold})\n`]
        for (const pt of report.points) {
          lines.push(`  ${pt.after.date}  dist: ${pt.distance.toFixed(3)}  before: [${pt.before.commit.slice(0, 7)}] → after: [${pt.after.commit.slice(0, 7)}]`)
          const path = pt.after.topPaths[0] ?? pt.before.topPaths[0] ?? '(unknown path)'
          lines.push(`    ${path}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: semantic_search
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Tool: semantic_diff
  // -------------------------------------------------------------------------
  server.tool(
    'semantic_diff',
    'Compute a conceptual/semantic diff of a topic across two git refs — shows gained, lost, and stable concepts.',
    {
      ref1: z.string().describe('Earlier git ref (branch, tag, commit hash, or date)'),
      ref2: z.string().describe('Later git ref'),
      query: z.string().describe('Topic query to embed and compare'),
      top_k: z.number().int().positive().optional().default(10),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ ref1, ref2, query, top_k, branch }) => {
      try {
        const provider = getTextProvider()
        const qEmb = await embedQuery(provider, query)
        const result = computeSemanticDiff(qEmb, query, ref1, ref2, top_k, branch)
        const lines: string[] = []
        lines.push(`Semantic diff: "${result.topic}"`)
        lines.push(`ref1: ${result.ref1}  (${result.timestamp1 ? formatDate(result.timestamp1) : 'unknown'})`)
        lines.push(`ref2: ${result.ref2}  (${result.timestamp2 ? formatDate(result.timestamp2) : 'unknown'})`)
        lines.push('')
        const render = (label: string, list: any[]) => {
          lines.push(`${label}:`)
          if (list.length === 0) lines.push('  (none)')
          for (const e of list) {
            const p = e.paths[0] ?? '(unknown)'
            lines.push(`  ${formatDate(e.firstSeen)}  ${p}  [${e.blobHash.slice(0,7)}]  score=${e.score.toFixed(3)}`)
          }
          lines.push('')
        }
        render('Gained', result.gained)
        render('Lost', result.lost)
        render('Stable', result.stable)
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: semantic_blame
  // -------------------------------------------------------------------------
  server.tool(
    'semantic_blame',
    'Show semantic origin of each logical block in a file — finds nearest-neighbor blobs in the index.',
    {
      file_path: z.string().describe('Path to the file to blame'),
      top_k: z.number().int().positive().optional().default(3),
      level: z.enum(['file', 'symbol']).optional().default('file'),
      branch: z.string().optional(),
    },
    async ({ file_path, top_k, level, branch }) => {
      try {
        const provider = getTextProvider()
        // Attempt to read blob content from the store
        const content = getBlobContent(file_path) ?? ''
        if (!content) return { content: [{ type: 'text', text: `File not found in blob store: ${file_path}` }] }
        const entries = await computeSemanticBlame(file_path, content, provider, { topK: top_k, searchSymbols: level === 'symbol', branch })
        if (entries.length === 0) return { content: [{ type: 'text', text: '(no entries)' }] }
        const lines: string[] = [`Semantic blame: ${file_path}`, '']
        for (const entry of entries) {
          lines.push(`─ ${entry.label} (lines ${entry.startLine}–${entry.endLine})`)
          if (entry.neighbors.length === 0) {
            lines.push('  (no indexed blobs)')
            lines.push('')
            continue
          }
          for (const n of entry.neighbors) {
            lines.push(`  ${n.similarity.toFixed(3)}  ${n.paths[0] ?? '(unknown)'}  [${n.blobHash.slice(0,7)}]`)
            if (n.commitHash) lines.push(`    commit: ${n.commitHash.slice(0,7)}  (${n.timestamp ? formatDate(n.timestamp) : 'unknown'})`)
            if (n.author) lines.push(`    author: ${n.author}`)
            if (n.message) lines.push(`    message: ${n.message.split('\n')[0]}`)
          }
          lines.push('')
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: file_change_points
  // -------------------------------------------------------------------------
  server.tool(
    'file_change_points',
    "Detect semantic change points in a file's Git history.",
    {
      path: z.string().describe('File path to analyze'),
      threshold: z.number().min(0).max(2).optional().default(0.3).describe('Cosine distance threshold to emit a change point'),
      top_points: z.number().int().positive().optional().default(5).describe('Number of change points to return'),
      branch: z.string().optional(),
    },
    async ({ path, threshold, top_points, branch }) => {
      try {
        const report = computeFileChangePoints(path, { threshold, topPoints: top_points, branch })
        if (report.points.length === 0) return { content: [{ type: 'text', text: '(no change points found)' }] }
        const lines = [`File change points for: ${path}`, '']
        for (const p of report.points) {
          lines.push(`  ${p.before.date} → ${p.after.date}  dist=${p.distance.toFixed(3)}  ${p.before.blobHash.slice(0,7)} → ${p.after.blobHash.slice(0,7)}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: cluster_diff
  // -------------------------------------------------------------------------
  server.tool(
    'cluster_diff',
    'Compare semantic clusters between two points in history.',
    {
      ref1: z.string(),
      ref2: z.string(),
      k: z.number().int().positive().optional().default(8),
    },
    async ({ ref1, ref2, k }) => {
      try {
        const ts1 = resolveRefToTimestamp(ref1)
        const ts2 = resolveRefToTimestamp(ref2)
        const hashes1 = getBlobHashesUpTo(ts1)
        const hashes2 = getBlobHashesUpTo(ts2)
        const snapshot1 = await computeClusterSnapshot({ k, blobHashFilter: hashes1 })
        const snapshot2 = await computeClusterSnapshot({ k, blobHashFilter: hashes2 })
        const report = compareClusterSnapshots(snapshot1, snapshot2, ref1, ref2)
        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: cluster_timeline
  // -------------------------------------------------------------------------
  server.tool(
    'cluster_timeline',
    'Track how semantic clusters evolve through commit history.',
    {
      since: z.string().optional(),
      until: z.string().optional(),
      k: z.number().int().positive().optional().default(8),
      branch: z.string().optional(),
    },
    async ({ since, until, k, branch }) => {
      try {
        const opts: { k: number; since?: number; until?: number; branch?: string } = { k }
        if (since) opts.since = parseDateArg(since)
        if (until) opts.until = parseDateArg(until)
        if (branch) opts.branch = branch
        const report = await computeClusterTimeline(opts)
        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: author
  // -------------------------------------------------------------------------
  server.tool(
    'author',
    'Find which authors have contributed most to a semantic concept in the codebase.',
    {
      query: z.string().describe('Natural-language concept to attribute'),
      top_k: z.number().int().positive().optional().default(50).describe('Number of top blobs to attribute'),
      top_authors: z.number().int().positive().optional().default(10).describe('Number of top authors to return'),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ query, top_k, top_authors, branch }) => {
      try {
        const provider = getTextProvider()
        const queryEmbedding = await embedQuery(provider, query)
        const contributions = await computeAuthorContributions(queryEmbedding, { topK: top_k, topAuthors: top_authors, branch })
        if (contributions.length === 0) {
          return { content: [{ type: 'text', text: 'No author contributions found.' }] }
        }
        const lines = [`Authors for: "${query}"\n`]
        for (const c of contributions) {
          lines.push(`  ${c.authorName} <${c.authorEmail}>  score: ${c.totalScore.toFixed(3)}  blobs: ${c.blobCount}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: impact
  // -------------------------------------------------------------------------
  server.tool(
    'impact',
    'Find blobs most semantically coupled to a file — shows what else in the codebase will be affected by changes to that file.',
    {
      file: z.string().describe('Path to the file to analyse (relative to repo root)'),
      top_k: z.number().int().positive().optional().default(10).describe('Number of similar blobs to return'),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ file, top_k, branch }) => {
      try {
        const provider = getTextProvider()
        const report = await computeImpact(file, provider, { topK: top_k, branch })
        if (report.results.length === 0) {
          return { content: [{ type: 'text', text: `No semantically coupled blobs found for: ${file}` }] }
        }
        const lines = [`Impact analysis: ${file}  (${report.results.length} neighbors)\n`]
        for (const n of report.results) {
          const path = n.paths[0] ?? '(unknown path)'
          lines.push(`  ${n.score.toFixed(3)}  ${path}  [${n.blobHash.slice(0, 7)}]`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: dead_concepts
  // -------------------------------------------------------------------------
  server.tool(
    'dead_concepts',
    'Find blobs that existed historically but are no longer reachable from HEAD — deleted or removed concepts.',
    {
      top_k: z.number().int().positive().optional().default(10).describe('Number of dead blobs to return'),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ top_k, branch }) => {
      try {
        const results = await findDeadConcepts({ topK: top_k, branch })
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No dead concepts found.' }] }
        }
        const lines = [`Dead concepts (${results.length} found):\n`]
        for (const r of results) {
          const path = r.paths[0] ?? '(unknown path)'
          const date = r.lastSeenDate !== null ? formatDate(r.lastSeenDate) : 'unknown date'
          lines.push(`  ${r.score.toFixed(3)}  ${path}  last seen: ${date}`)
          if (r.lastSeenMessage) lines.push(`    commit: ${r.lastSeenMessage}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: security_scan
  // -------------------------------------------------------------------------
  server.tool(
    'security_scan',
    'Scan the codebase for blobs semantically similar to common vulnerability patterns.\n⚠️ Results are similarity scores, NOT confirmed vulnerabilities. Manual review required.',
    {
      top: z.number().int().positive().optional().default(10).describe('Number of results per pattern'),
    },
    async ({ top }) => {
      try {
        const provider = getTextProvider()
        const session = getActiveSession()
        const findings = await scanForVulnerabilities(session, provider, { top })
        if (findings.length === 0) {
          return { content: [{ type: 'text', text: '⚠️ Semantic similarity scan only — not confirmed vulnerabilities.\nNo high-similarity blobs found for any vulnerability pattern.' }] }
        }
        const lines = ['⚠️ Results are semantic similarity scores, NOT confirmed vulnerabilities. Manual review required.\n']
        for (const f of findings) {
          const path = f.paths[0] ?? '(unknown path)'
          lines.push(`[${f.patternName}]  score=${f.score.toFixed(3)}  ${path}  [${f.blobHash.slice(0, 7)}]`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: health_timeline
  // -------------------------------------------------------------------------
  server.tool(
    'health_timeline',
    'Show time-bucketed codebase health metrics: active blob count, semantic churn rate, and dead-concept ratio per period.',
    {
      buckets: z.number().int().positive().optional().default(12).describe('Number of time buckets'),
      branch: z.string().optional().describe('Restrict to commits on this branch'),
    },
    ({ buckets, branch }) => {
      try {
        const session = getActiveSession()
        const snaps = computeHealthTimeline(session, { buckets, branch })
        if (snaps.length === 0) {
          return { content: [{ type: 'text', text: 'No commits found in the index.' }] }
        }
        const lines = [`Health timeline (${snaps.length} buckets):\n`]
        for (const s of snaps) {
          const start = new Date(s.periodStart * 1000).toISOString().slice(0, 10)
          const end = new Date(s.periodEnd * 1000).toISOString().slice(0, 10)
          lines.push(`  ${start}–${end}  active=${s.activeBlobCount}  churn=${s.semanticChurnRate.toFixed(3)}  dead=${s.deadConceptRatio.toFixed(3)}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Tool: debt_score
  // -------------------------------------------------------------------------
  server.tool(
    'debt_score',
    'Score blobs by technical debt: isolation (semantic distance from neighbours), age, and low change frequency.',
    {
      top: z.number().int().positive().optional().default(20).describe('Number of top-debt blobs to return'),
      branch: z.string().optional().describe('Restrict to blobs on this branch'),
    },
    async ({ top, branch }) => {
      try {
        const provider = getTextProvider()
        const session = getActiveSession()
        const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
        const results = await scoreDebt(session, provider, { top, branch, model })
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No blobs found.' }] }
        }
        const lines = [`Top-${results.length} debt blobs:\n`]
        for (const r of results) {
          const path = r.paths[0] ?? '(unknown path)'
          lines.push(`  ${r.debtScore.toFixed(3)}  ${path.padEnd(50)}  isolation=${r.isolationScore.toFixed(3)}  age=${r.ageScore.toFixed(3)}  chg=${r.changeFrequency}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // -------------------------------------------------------------------------
  // Connect transport and start
  // -------------------------------------------------------------------------
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
