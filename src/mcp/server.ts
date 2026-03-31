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
import { computeEvolution } from '../core/search/evolution.js'
import { runIndex } from '../core/indexing/indexer.js'
import { OllamaProvider } from '../core/embedding/local.js'
import { HttpProvider } from '../core/embedding/http.js'
import type { EmbeddingProvider } from '../core/embedding/provider.js'
import type { SearchResult } from '../core/models/types.js'
import { formatDate } from '../core/search/ranking.js'
import { parseDateArg } from '../core/search/timeSearch.js'
import { DEFAULT_MAX_SIZE } from '../core/git/showBlob.js'

// ---------------------------------------------------------------------------
// Provider factory (mirrors the logic in CLI commands)
// ---------------------------------------------------------------------------

function buildProvider(providerType: string, model: string): EmbeddingProvider {
  if (providerType === 'http') {
    const baseUrl = process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      throw new Error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
    }
    return new HttpProvider({ baseUrl, model, apiKey: process.env.GITSEMA_API_KEY })
  }
  return new OllamaProvider({ model })
}

function getTextProvider(): EmbeddingProvider {
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  return buildProvider(providerType, model)
}

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
      let queryEmbedding: number[]
      try {
        queryEmbedding = await provider.embed(query)
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
      let queryEmbedding: number[]
      try {
        queryEmbedding = await provider.embed(query)
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
      let queryEmbedding: number[]
      try {
        queryEmbedding = await provider.embed(query)
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
    },
    async ({ path, threshold, structured }) => {
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
          timeline: entries.map((e, i) => ({
            index: i,
            date: formatDate(e.timestamp),
            timestamp: e.timestamp,
            blobHash: e.blobHash,
            commitHash: e.commitHash,
            distFromPrev: e.distFromPrev,
            distFromOrigin: e.distFromOrigin,
            isOrigin: i === 0,
            isLargeChange: i > 0 && e.distFromPrev >= threshold,
          })),
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
      const textProvider = buildProvider(providerType, textModel)
      const codeProvider = codeModelName !== textModel ? buildProvider(providerType, codeModelName) : undefined

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
        ? ext.split(',').map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
        : undefined
      const excludeFilter = exclude
        ? exclude.split(',').map((e) => e.trim()).filter(Boolean)
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
  // Connect transport and start
  // -------------------------------------------------------------------------
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
