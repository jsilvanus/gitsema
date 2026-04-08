import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTool } from '../registerTool.js'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { runIndex } from '../../core/indexing/indexer.js'
import { DEFAULT_MAX_SIZE } from '../../core/git/showBlob.js'

export function registerInfrastructureTools(server: McpServer) {
  registerTool(
    server,
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
}
