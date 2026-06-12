/**
 * guideTools — gitsema tool registry for the `gitsema guide` agentic loop.
 *
 * Exposes a fixed set of `ToolDefinition`s (JSON-schema parameter shapes) plus
 * a single `executeTool` dispatcher that `runAgentLoop` (from
 * `@jsilvanus/chattydeer`) calls back into for each tool invocation.
 *
 * All tool results are returned as compact, size-capped JSON strings — the
 * agent loop feeds these back to the LLM as `tool` messages. Tools never
 * throw: failures are converted into a structured `{ error: ... }` JSON
 * payload so the LLM can react gracefully.
 *
 * TODO (not yet wired — need index + heavier plumbing):
 *   - file_evolution    (per-file semantic drift; src/core/search/temporal/evolution.ts)
 *   - concept_evolution (codebase-wide concept drift; src/core/search/temporal/evolution.ts)
 *   - branch_summary    (branch vs main semantic summary; src/mcp/tools/analysis.ts)
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fetchCommitEvents, runNarrate, runExplain } from './narrator.js'
import { createDisabledProvider } from './chattydeerProvider.js'
import { getActiveSession, DB_PATH } from '../db/sqlite.js'
import { getTextProvider } from '../embedding/providerFactory.js'
import { embedQuery } from '../embedding/embedQuery.js'
import { vectorSearch } from '../search/analysis/vectorSearch.js'
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Result size capping
// ---------------------------------------------------------------------------

const MAX_RESULT_CHARS = 4000

/** Serialize `value` to JSON and cap the result to ~4000 chars. */
function toCappedJson(value: unknown): string {
  let json: string
  try {
    json = JSON.stringify(value)
  } catch (err) {
    return JSON.stringify({ error: `serialization failed: ${err instanceof Error ? err.message : String(err)}` })
  }
  if (json.length <= MAX_RESULT_CHARS) return json
  return `${json.slice(0, MAX_RESULT_CHARS)}…truncated`
}

function errorResult(message: string): string {
  return toCappedJson({ error: message })
}

// ---------------------------------------------------------------------------
// Tool definitions (JSON-schema parameters for the LLM)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const GUIDE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'repo_stats',
    description: 'Basic repository statistics: branch count, tag count, total commit count, and configured remotes.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'recent_commits',
    description: 'Fetch the N most recent git commits (hash, date, subject).',
    parameters: {
      type: 'object',
      properties: {
        n: {
          type: 'integer',
          description: 'Number of commits to return (default 20, max 100).',
          minimum: 1,
          maximum: 100,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'narrate_repo',
    description: 'Return structured commit evidence for a date range and optional focus (evidence only — does not call an LLM).',
    parameters: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Start date (e.g. "2024-01-01") or git-recognized date expression.' },
        until: { type: 'string', description: 'End date (e.g. "2024-12-31") or git-recognized date expression.' },
        focus: {
          type: 'string',
          description: 'Restrict to a category of commits.',
          enum: ['bugs', 'features', 'ops', 'security', 'deps', 'performance', 'all'],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'explain_topic',
    description: 'Return commits whose subject/body match a topic, for incident/feature investigation (evidence only — does not call an LLM).',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Keyword(s) or phrase to search commit messages for.' },
        since: { type: 'string', description: 'Start date or git-recognized date expression.' },
        until: { type: 'string', description: 'End date or git-recognized date expression.' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'semantic_search',
    description: 'Vector similarity search over the indexed git history (requires a .gitsema index and a reachable embedding provider). Returns the top matching files/blobs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language search query.' },
        topK: { type: 'integer', description: 'Number of results to return (default 10, max 25).', minimum: 1, maximum: 25 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
]

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

export function toolRepoStats(): string {
  try {
    // Count in JS rather than piping through `wc -l` etc. — the shell
    // built-ins differ between POSIX and Windows cmd.
    const countLines = (cmd: string): number => {
      try {
        const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
        return out ? out.split('\n').filter(Boolean).length : 0
      } catch {
        return 0
      }
    }
    const branches = countLines('git branch --list')
    const tags = countLines('git tag --list')
    let commits = 0
    try {
      commits = parseInt(
        execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
        10,
      ) || 0
    } catch {
      commits = 0
    }
    let remotes: string[] = []
    try {
      remotes = execSync('git remote -v', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(0, 4)
    } catch {
      remotes = []
    }
    return toCappedJson({ branches, tags, commits, remotes })
  } catch (err) {
    return errorResult(`repo_stats failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function toolRecentCommits(args: Record<string, unknown>): string {
  const nRaw = typeof args.n === 'number' ? args.n : parseInt(String(args.n ?? '20'), 10)
  const n = Number.isFinite(nRaw) ? Math.min(Math.max(Math.trunc(nRaw), 1), 100) : 20
  try {
    const raw = execSync(`git log --max-count=${n} --format=%H%x1F%ai%x1F%s%x1E`, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    }).trim()
    const commits = raw
      .split('\x1E')
      .map((rec) => rec.trim())
      .filter(Boolean)
      .map((rec) => {
        const [hash, date, subject] = rec.split('\x1F')
        return { hash: hash?.trim() ?? '', date: date?.trim() ?? '', subject: subject?.trim() ?? '' }
      })
    return toCappedJson({ commits })
  } catch (err) {
    return errorResult(`recent_commits failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * narrate_repo — evidence-only commit gathering for a date range/focus.
 * Reuses runNarrate's evidence path (evidenceOnly defaults to true), which
 * never triggers a nested LLM call.
 */
async function toolNarrateRepo(args: Record<string, unknown>): Promise<string> {
  const since = typeof args.since === 'string' ? args.since : undefined
  const until = typeof args.until === 'string' ? args.until : undefined
  const focusRaw = typeof args.focus === 'string' ? args.focus : 'all'
  const focus = (['bugs', 'features', 'ops', 'security', 'deps', 'performance', 'all'].includes(focusRaw)
    ? focusRaw
    : 'all') as 'bugs' | 'features' | 'ops' | 'security' | 'deps' | 'performance' | 'all'

  try {
    // Evidence-only path never calls the provider — pass a disabled provider.
    const result = await runNarrate(createDisabledProvider(), {
      since,
      until,
      focus,
      evidenceOnly: true,
    })
    return toCappedJson({
      commitCount: result.commitCount,
      citations: result.citations,
      evidence: result.evidence,
    })
  } catch (err) {
    return errorResult(`narrate_repo failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * explain_topic — evidence-only keyword match over commit history.
 * Reuses runExplain's evidence path (evidenceOnly defaults to true), which
 * never triggers a nested LLM call.
 */
async function toolExplainTopic(args: Record<string, unknown>): Promise<string> {
  const topic = typeof args.topic === 'string' ? args.topic : ''
  if (!topic.trim()) {
    return errorResult('explain_topic requires a non-empty "topic" argument')
  }
  const since = typeof args.since === 'string' ? args.since : undefined
  const until = typeof args.until === 'string' ? args.until : undefined

  try {
    const result = await runExplain(createDisabledProvider(), topic, {
      since,
      until,
      evidenceOnly: true,
    })
    return toCappedJson({
      commitCount: result.commitCount,
      citations: result.citations,
      evidence: result.evidence,
    })
  } catch (err) {
    return errorResult(`explain_topic failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * semantic_search — vector similarity search over the .gitsema index.
 *
 * Fails fast (without throwing) when:
 *   - no .gitsema/index.db exists in cwd, or
 *   - the configured embedding provider is unreachable.
 */
async function toolSemanticSearch(args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === 'string' ? args.query : ''
  if (!query.trim()) {
    return errorResult('semantic_search requires a non-empty "query" argument')
  }
  const topKRaw = typeof args.topK === 'number' ? args.topK : parseInt(String(args.topK ?? '10'), 10)
  const topK = Number.isFinite(topKRaw) ? Math.min(Math.max(Math.trunc(topKRaw), 1), 25) : 10

  if (!existsSync(join(process.cwd(), DB_PATH))) {
    return errorResult('no .gitsema index found in the current directory — run `gitsema index` first')
  }

  try {
    // Ensure the DB session is open (throws if the DB cannot be opened).
    getActiveSession()

    const provider = getTextProvider()
    const queryEmbedding = await embedQuery(provider, query)

    const results = vectorSearch(queryEmbedding, {
      topK,
      model: provider.model,
      queryText: query,
    })

    return toCappedJson({
      query,
      results: results.map((r) => ({
        paths: r.paths,
        score: r.score,
        blobHash: r.blobHash,
      })),
    })
  } catch (err) {
    return errorResult(`semantic_search unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * Execute a single tool call by name. Always resolves to a string (never
 * throws) — unknown tools and per-tool errors are returned as structured
 * `{ error: ... }` JSON so the agent loop can feed them back to the LLM.
 */
export async function executeTool(call: ToolCall): Promise<string> {
  const { name, arguments: args } = call
  try {
    switch (name) {
      case 'repo_stats':
        return toolRepoStats()
      case 'recent_commits':
        return toolRecentCommits(args)
      case 'narrate_repo':
        return await toolNarrateRepo(args)
      case 'explain_topic':
        return await toolExplainTopic(args)
      case 'semantic_search':
        return await toolSemanticSearch(args)
      default:
        return errorResult(`unknown tool: ${name}`)
    }
  } catch (err) {
    logger.warn(`[guideTools] tool "${name}" threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`)
    return errorResult(`tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
