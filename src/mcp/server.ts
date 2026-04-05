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
import { runIndex } from '../core/indexing/indexer.js'
import { getBlobContent } from '../core/indexing/blobStore.js'
import { buildProvider, getTextProvider, getCodeProvider } from '../core/embedding/providerFactory.js'
import { embedQuery } from '../core/embedding/embedQuery.js'
import type { SearchResult, Embedding } from '../core/models/types.js'
import { formatDate } from '../core/search/ranking.js'
import { parseDateArg } from '../core/search/timeSearch.js'
import { DEFAULT_MAX_SIZE } from '../core/git/showBlob.js'
import { getMergeBase, getBranchExclusiveBlobs } from '../core/git/branchDiff.js'
import { computeSemanticCollisions, computeMergeImpact } from '../core/search/mergeAudit.js'
import { computeBranchSummary } from '../core/search/branchSummary.js'
import { computeClusters } from '../core/search/clustering.js'
import { computeConceptChangePoints } from '../core/search/changePoints.js'
import { computeAuthorContributions } from '../core/search/authorSearch.js'
import { computeImpact } from '../core/search/impact.js'
import { findDeadConcepts } from '../core/search/deadConcepts.js'

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
    },
    async ({ query, top_k, recent, alpha, before, after }) => {
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

      const results = vectorSearch(queryEmbedding, {
        topK: top_k,
        recent,
        alpha,
        before: beforeTs,
        after: afterTs,
      })

      return { content: [{ type: 'text', text: serializeSearchResults(results) }] }
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
        model: (provider as any).model,
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
    },
    async ({ query, top_k, before, after, sort_by_date }) => {
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
    },
    async ({ query, top_k }) => {
      const provider = getTextProvider()
      let queryEmbedding: Embedding
      try {
        queryEmbedding = await embedQuery(provider, query)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error embedding query: ${msg}` }] }
      }

      const results = vectorSearch(queryEmbedding, { topK: top_k })

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

      return { content: [{ type: 'text', text: lines.join('\n') }] }
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
  // Connect transport and start
  // -------------------------------------------------------------------------
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
