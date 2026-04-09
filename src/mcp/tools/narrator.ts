/**
 * MCP tool registrations for narrator/explainer functionality.
 *
 * Tools:
 *   narrate_repo           — generate a narrative of repo development history
 *   explain_issue_or_error — explain a bug/error topic via git history
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resolveNarratorProvider, runNarrate, runExplain } from '../../core/narrator/index.js'

export function registerNarratorTools(server: McpServer) {
  // narrate_repo
  server.tool(
    'narrate_repo',
    'Generate a human-readable narrative of repository development history using the configured LLM narrator model. Safe-by-default: returns a placeholder when no narrator model is configured.',
    {
      since: z.string().optional().describe('Only include commits after this ref or date (e.g. "v1.0", "2024-01-01")'),
      until: z.string().optional().describe('Only include commits before this ref or date'),
      range: z.string().optional().describe('Git revision range (e.g. "v1.0..HEAD")'),
      focus: z.enum(['bugs', 'features', 'ops', 'security', 'deps', 'performance', 'all']).optional().default('all').describe('Filter commits by category'),
      format: z.enum(['md', 'text', 'json']).optional().default('md').describe('Output format'),
      max_commits: z.number().int().positive().optional().describe('Maximum commits to analyse'),
      narrator_model_id: z.number().int().positive().optional().describe('embed_config.id of the narrator model to use'),
      model: z.string().optional().describe('Narrator model name to use (overrides active selection)'),
    },
    async ({ since, until, range, focus, format, max_commits, narrator_model_id, model }) => {
      const provider = resolveNarratorProvider({
        narratorModelId: narrator_model_id,
        modelName: model,
      })

      try {
        const result = await runNarrate(provider, {
          since,
          until,
          range,
          focus: focus as 'bugs' | 'features' | 'ops' | 'security' | 'deps' | 'performance' | 'all',
          format: format as 'md' | 'text' | 'json',
          maxCommits: max_commits,
        })

        let text: string
        if (format === 'json') {
          text = JSON.stringify({
            prose: result.prose,
            commitCount: result.commitCount,
            citations: result.citations,
            llmEnabled: result.llmEnabled,
          }, null, 2)
        } else {
          text = [
            result.prose,
            '',
            result.citations.length > 0 ? `Citations: ${result.citations.slice(0, 10).map((h) => h.slice(0, 12)).join(', ')}` : '',
            `${result.commitCount} commit(s) analysed`,
            result.redactedFields.length > 0 ? `Redacted: ${result.redactedFields.join(', ')}` : '',
          ].filter(Boolean).join('\n')
        }

        return { content: [{ type: 'text' as const, text }] }
      } finally {
        await provider.destroy()
      }
    },
  )

  // explain_issue_or_error
  server.tool(
    'explain_issue_or_error',
    'Explain a bug, error, or concept by tracing it through git history using the configured LLM narrator model. Returns a timeline with commit citations.',
    {
      topic: z.string().min(1).describe('The bug, error message, or concept to explain (e.g. "NullPointerException in auth handler")'),
      since: z.string().optional().describe('Only include commits after this ref or date'),
      until: z.string().optional().describe('Only include commits before this ref or date'),
      format: z.enum(['md', 'text', 'json']).optional().default('md').describe('Output format'),
      narrator_model_id: z.number().int().positive().optional().describe('embed_config.id of the narrator model to use'),
      model: z.string().optional().describe('Narrator model name to use (overrides active selection)'),
    },
    async ({ topic, since, until, format, narrator_model_id, model }) => {
      const provider = resolveNarratorProvider({
        narratorModelId: narrator_model_id,
        modelName: model,
      })

      try {
        const result = await runExplain(provider, topic, {
          since,
          until,
          format: format as 'md' | 'text' | 'json',
        })

        let text: string
        if (format === 'json') {
          text = JSON.stringify({
            prose: result.prose,
            commitCount: result.commitCount,
            citations: result.citations,
            llmEnabled: result.llmEnabled,
          }, null, 2)
        } else {
          text = [
            result.prose,
            '',
            result.citations.length > 0 ? `Citations: ${result.citations.slice(0, 10).map((h) => h.slice(0, 12)).join(', ')}` : '',
            `${result.commitCount} related commit(s) found`,
            result.redactedFields.length > 0 ? `Redacted: ${result.redactedFields.join(', ')}` : '',
          ].filter(Boolean).join('\n')
        }

        return { content: [{ type: 'text' as const, text }] }
      } finally {
        await provider.destroy()
      }
    },
  )
}
