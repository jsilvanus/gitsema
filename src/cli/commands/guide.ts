/**
 * `gitsema guide` — interactive LLM chat with access to gitsema tools.
 *
 * The guide uses the active "guide" model config (kind='guide' in embed_config),
 * falling back to the active narrator model. It builds a context from gitsema
 * search results and recent git history, then runs a real agentic tool-calling
 * loop (via `@jsilvanus/chattydeer`'s `createAgentSession` + `runAgentLoop`) so
 * the LLM can call the full set of gitsema analysis tools (see
 * `guideTools.ts`'s `GUIDE_TOOLS` registry) to gather additional evidence
 * before answering. The system prompt embeds a per-tool "how to interpret
 * results" catalog from `interpretations.ts`.
 *
 * Safe-by-default: if no guide or narrator model is configured the command
 * prints the gathered context without calling an LLM or chattydeer — no
 * network access occurs.
 */

import type { Command } from 'commander'
import { createInterface } from 'node:readline'
import { resolveGuideConfig } from '../../core/narrator/resolveNarrator.js'
import { redactAll } from '../../core/narrator/redact.js'
import { withAudit } from '../../core/narrator/audit.js'
import { GUIDE_TOOL_DEFINITIONS, executeTool, repoStatsData, recentCommitsData } from '../../core/narrator/guideTools.js'
import { buildGuideToolCatalog } from '../../core/narrator/interpretations.js'
import { isCliParams, type NarratorModelConfig } from '../../core/narrator/types.js'
import { getCliAdapter } from '../../core/narrator/cliAdapters.js'
import { runCli } from '../../core/narrator/cliProvider.js'
import { writeGitsemaMcpConfig } from '../../core/narrator/cliMcpConfig.js'
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Context gathering helpers
// ---------------------------------------------------------------------------

/** Gather quick context for the guide prompt. */
function gatherContext(_question: string): string {
  const parts: string[] = []

  const recent = recentCommitsData(15)
  const recentLines = recent.commits.map((c) => `${c.hash} ${c.date} ${c.subject}`).join('\n')
  parts.push(`## Recent commits\n${recentLines || '(git log failed)'}`)

  const stats = repoStatsData()
  parts.push(`## Repository stats\nBranches: ${stats.branches}  Tags: ${stats.tags}  Commits: ${stats.commits}\nRemotes:\n${stats.remotes.join('\n')}`)

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Build the guide's system prompt dynamically: role/goal, tool-use strategy,
 * and the full per-tool "how to interpret results" catalog from
 * `interpretations.ts` (so the prompt never drifts from the actual tool set).
 */
function buildSystemPrompt(): string {
  return [
    'You are gitsema-guide, an expert assistant for the git repository the user is working in.',
    'You have access to repository context gathered by gitsema tools, and you can call gitsema',
    'tools to gather more evidence before answering — search broadly first, then drill into',
    'specific files, concepts, or time ranges. Chain tool calls when one result suggests another',
    '(e.g. a change point suggests inspecting that commit\'s author or impact). You have up to 5',
    'tool-call roundtrips per turn — use them judiciously.',
    '',
    'Prefer evidence from tool results over speculation. If a tool returns `{"error": "..."}`,',
    'read the message: if it says no index is available, fall back to git-only tools',
    '(repo_stats, recent_commits, narrate_repo, explain_topic) and tell the user that semantic',
    'search/analysis tools require running `gitsema index` first.',
    '',
    'Always cite commit hashes and/or blob hashes when referencing specific changes or files.',
    'Be concise, factual, and clearly label any inference that goes beyond the evidence.',
    '',
    'Available tools and how to interpret their results:',
    buildGuideToolCatalog(),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// chattydeer provider/session construction (lazy import)
// ---------------------------------------------------------------------------

/**
 * Minimal shape of the chattydeer module surface this file relies on.
 * chattydeer ships .d.ts but several signatures are typed `any` —
 * these narrower local types document the actual contract we depend on
 * (verified against chattydeer 0.4.5).
 */
interface ChattydeerModule {
  createChatProvider(httpUrl: string | undefined, model: string, apiKey?: string, opts?: { timeoutMs?: number }): {
    complete(req?: unknown): Promise<unknown>
    stream(req?: unknown): AsyncGenerator<unknown, void, unknown>
    destroy(): Promise<void>
  }
  createAgentSession(opts?: { systemPrompt?: string; messages?: unknown[] }): {
    readonly history: unknown[]
    append(msg: unknown): void
  }
  runAgentLoop(session: unknown, opts: {
    provider: unknown
    tools: typeof GUIDE_TOOL_DEFINITIONS
    executeTool(call: { id: string; name: string; arguments: Record<string, unknown> }): Promise<string>
    maxRoundtrips?: number
    maxTokens?: number
    temperature?: number
    onMessage?(msg: unknown): void
    redactContent?(text: string): string
  }): Promise<{ answer: string; messages: unknown[]; roundtrips: number }>
}

let _chattydeerModule: ChattydeerModule | null = null

async function getChattydeerModule(): Promise<ChattydeerModule> {
  if (_chattydeerModule === null) {
    // @ts-ignore — chattydeer is a plain JS ESM package without strict types
    _chattydeerModule = await import('@jsilvanus/chattydeer') as unknown as ChattydeerModule
  }
  return _chattydeerModule
}

/** A reusable agent session across multiple turns (interactive mode), backed by chattydeer. */
export interface ChattydeerGuideSession {
  kind: 'chattydeer'
  agentSession: ReturnType<ChattydeerModule['createAgentSession']>
  provider: ReturnType<ChattydeerModule['createChatProvider']>
  config: NarratorModelConfig
}

/**
 * A reusable session for a CLI-based guide provider. Conversational context
 * across turns is delegated to the CLI tool's own session-resume mechanism
 * (e.g. Claude Code's `--resume <session-id>`), tracked via `sessionId`.
 */
export interface CliGuideSession {
  kind: 'cli'
  config: NarratorModelConfig
  /** Path to a temporary MCP config exposing gitsema's tools, if useMcp is set. */
  mcpConfigPath?: string
  /** Session id returned by the CLI tool, used to resume on the next turn. */
  sessionId?: string
}

/** A reusable agent session across multiple turns (interactive mode). */
export type GuideSession = ChattydeerGuideSession | CliGuideSession

/** True when `config` describes an enabled (non-disabled) guide/narrator provider. */
function isGuideConfigEnabled(config: NarratorModelConfig | null): boolean {
  if (!config) return false
  if (isCliParams(config.params)) return !!config.params.cliCommand
  return !!config.params.httpUrl
}

/**
 * Create a guide session from a resolved guide model config. For CLI
 * providers no subprocess is started yet (one is spawned per turn); for
 * chattydeer providers a chat provider + agent session is created. Caller is
 * responsible for calling `destroyGuideSession()` when done.
 */
async function createGuideSession(config: NarratorModelConfig, systemPrompt: string): Promise<GuideSession> {
  if (config.provider === 'cli' && isCliParams(config.params)) {
    const mcpConfigPath = config.params.useMcp ? writeGitsemaMcpConfig(process.cwd()) : undefined
    return { kind: 'cli', config, mcpConfigPath }
  }

  const mod = await getChattydeerModule()
  const params = config.params
  if (isCliParams(params)) {
    throw new Error(`guide model '${config.name}' has cli params but provider is '${config.provider}'`)
  }
  const provider = mod.createChatProvider(params.httpUrl, config.name, params.apiKey, {
    timeoutMs: 30_000,
  })
  const agentSession = mod.createAgentSession({ systemPrompt })
  return { kind: 'chattydeer', agentSession, provider, config }
}

/** Release any resources held by a guide session. No-op for CLI sessions. */
async function destroyGuideSession(session: GuideSession): Promise<void> {
  if (session.kind === 'chattydeer') {
    await session.provider.destroy()
  }
}

// ---------------------------------------------------------------------------
// Core guide Q&A
// ---------------------------------------------------------------------------

export interface RunGuideResult {
  answer: string
  contextUsed: boolean
  llmEnabled: boolean
  /** Number of LLM <-> tool roundtrips used (only present when the agent loop ran). */
  roundtrips?: number
  /** Names of tools invoked during the agent loop (only present when the agent loop ran). */
  toolCallsUsed?: string[]
}

/**
 * Run a single turn through a chattydeer-backed guide session, using the
 * in-process `runAgentLoop` + `GUIDE_TOOL_DEFINITIONS` agentic tool loop.
 */
async function runChattydeerGuideTurn(
  userPrompt: string,
  session: ChattydeerGuideSession,
  includeContext: boolean,
  firedPatterns: string[],
): Promise<RunGuideResult> {
  session.agentSession.append({ role: 'user', content: userPrompt })

  const mod = await getChattydeerModule()
  const params = session.config.params
  if (isCliParams(params)) {
    throw new Error(`guide model '${session.config.name}' has cli params but a chattydeer session`)
  }

  const toolCallsUsed: string[] = []

  const result = await withAudit('narrate', 'chattydeer', session.config.name, firedPatterns, async () => {
    return mod.runAgentLoop(session.agentSession, {
      provider: session.provider,
      tools: GUIDE_TOOL_DEFINITIONS,
      executeTool: async (call) => {
        toolCallsUsed.push(call.name)
        return executeTool(call)
      },
      maxRoundtrips: 5,
      maxTokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.3,
      redactContent: (text: string) => redactAll([text]).texts[0],
    })
  })

  return {
    answer: result.answer,
    contextUsed: includeContext,
    llmEnabled: true,
    roundtrips: result.roundtrips,
    toolCallsUsed,
  }
}

/**
 * Run a single turn through a CLI-based guide provider (e.g. Claude Code,
 * Codex, Copilot CLI). The system prompt + user prompt are combined into a
 * single prompt and handed to the CLI tool; if `useMcp` is set, the CLI tool
 * is given `--mcp-config` pointing at gitsema's own MCP server so its own
 * agent loop can call gitsema's tools directly. Multi-turn context is
 * preserved via the CLI tool's session-resume mechanism (`session.sessionId`).
 */
async function runCliGuideTurn(
  userPrompt: string,
  session: CliGuideSession,
  includeContext: boolean,
  firedPatterns: string[],
): Promise<RunGuideResult> {
  const { config } = session
  const params = config.params
  if (!isCliParams(params)) {
    throw new Error(`guide model '${config.name}' has a cli session but non-cli params`)
  }

  const adapter = getCliAdapter(params.cliCommand)
  const prompt = `${buildSystemPrompt()}\n\n---\n\n${userPrompt}`
  const args = adapter.buildGuideArgs(prompt, params, {
    mcpConfigPath: session.mcpConfigPath,
    resumeSessionId: session.sessionId,
  })

  const result = await withAudit('narrate', 'cli', config.name, firedPatterns, async () => {
    const stdout = await runCli(params.cliCommand, args, params.timeoutMs ?? 60_000)
    return adapter.parseOutput(stdout)
  })

  if (result.sessionId) {
    session.sessionId = result.sessionId
  }

  return {
    answer: result.prose,
    contextUsed: includeContext,
    llmEnabled: true,
  }
}

/**
 * Run a single guide turn.
 *
 * When `session` is provided, the existing session is reused (multi-turn
 * interactive mode) and the caller owns its lifecycle (no resources are
 * released here). When `session` is omitted, a single-shot session is
 * created and released within this call.
 */
export async function runGuide(question: string, opts: {
  guideModelId?: number
  model?: string
  includeContext?: boolean
  session?: GuideSession
}): Promise<RunGuideResult> {
  const includeContext = opts.includeContext !== false

  // Build context (only gathered once per turn; on subsequent interactive
  // turns the conversation history already carries prior context).
  const context = includeContext ? gatherContext(question) : ''

  let config: NarratorModelConfig | null = null
  let session = opts.session
  if (session) {
    config = session.config
  } else {
    config = resolveGuideConfig({ guideModelId: opts.guideModelId, modelName: opts.model })
  }

  // Safe-by-default: no model configured — no network access / subprocess.
  if (!isGuideConfigEnabled(config)) {
    const answer = [
      '# Repository Context',
      '',
      context || '(no context gathered)',
      '',
      '---',
      '',
      `**Question:** ${question}`,
      '',
      '> No guide or narrator model configured. Run `gitsema models add <name> --guide --http-url <url> --activate`',
      '> or `gitsema models add <name> --guide --provider cli --cli-command <tool> --activate` to enable LLM answers.',
    ].join('\n')
    return { answer, contextUsed: includeContext, llmEnabled: false }
  }

  // Build the user prompt (context + question), redacted before it ever
  // leaves the process via chattydeer's `redactContent` hook (applied to
  // every outbound message) and as a defence-in-depth pre-redaction here.
  const rawUserPrompt = context
    ? `Repository context:\n${context}\n\n---\n\nQuestion: ${question}`
    : `Question: ${question}`

  const { texts, firedPatterns } = redactAll([rawUserPrompt])
  const userPrompt = texts[0]
  if (firedPatterns.length > 0) {
    logger.info(`[guide] redacted ${firedPatterns.length} pattern(s) from prompt`)
  }

  const ownSession = !session
  if (!session) {
    session = await createGuideSession(config!, buildSystemPrompt())
  }

  try {
    if (session.kind === 'cli') {
      return await runCliGuideTurn(userPrompt, session, includeContext, firedPatterns)
    }
    return await runChattydeerGuideTurn(userPrompt, session, includeContext, firedPatterns)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[guide] agent loop failed: ${msg}`)
    return {
      answer: `(guide error: ${msg})`,
      contextUsed: includeContext,
      llmEnabled: true,
      roundtrips: 0,
      toolCallsUsed: [],
    }
  } finally {
    if (ownSession && session) {
      await destroyGuideSession(session)
    }
  }
}

// ---------------------------------------------------------------------------
// CLI: single-shot Q&A
// ---------------------------------------------------------------------------

export async function guideCommand(
  question: string | undefined,
  opts: {
    guideModelId?: string
    model?: string
    noContext?: boolean
    interactive?: boolean
  },
): Promise<void> {
  const guideModelId = opts.guideModelId !== undefined ? parseInt(opts.guideModelId, 10) : undefined
  const includeContext = !opts.noContext

  // Interactive mode: read questions from stdin line-by-line, reusing one
  // agent session across turns so the conversation is multi-turn.
  if (opts.interactive || (!question && process.stdin.isTTY)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    console.log('gitsema guide — type your question (Ctrl-C or empty line to exit)\n')

    // Resolve the model config once; build a shared session lazily on first
    // turn if a model is configured (safe-by-default if not).
    const config = resolveGuideConfig({ guideModelId, modelName: opts.model })
    let session: GuideSession | undefined
    if (isGuideConfigEnabled(config)) {
      session = await createGuideSession(config!, buildSystemPrompt())
    }

    rl.prompt()
    rl.on('line', async (line) => {
      const q = line.trim()
      if (!q) { rl.close(); return }
      const { answer, llmEnabled } = await runGuide(q, { guideModelId, model: opts.model, includeContext, session })
      console.log(`\n${answer}\n`)
      if (!llmEnabled) {
        console.log('(No LLM model configured — showing context only.)\n')
      }
      rl.prompt()
    })
    rl.on('close', async () => {
      if (session) {
        await destroyGuideSession(session)
      }
      process.exit(0)
    })
    return
  }

  // Single-shot
  const q = question ?? ''
  if (!q) {
    console.error('Usage: gitsema guide <question> [options]')
    console.error('       gitsema guide --interactive')
    process.exit(1)
  }

  const { answer, llmEnabled } = await runGuide(q, { guideModelId, model: opts.model, includeContext })
  console.log(answer)
  if (!llmEnabled) {
    console.error('\n(No LLM model configured — run `gitsema models add <name> --guide --http-url <url> --activate`')
    console.error(' or `gitsema models add <name> --guide --provider cli --cli-command <tool> --activate` to enable.)')
  }
}

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

export function registerGuideCommand(program: Command): void {
  program
    .command('guide [question]')
    .description(
      'Interactive LLM chat that answers questions about this repository. ' +
      'Uses the active guide model (or narrator model as fallback) with a real ' +
      'agentic tool-calling loop over the full gitsema toolset (search, history, ' +
      'branch/merge, ownership, quality, diff/blame, clustering, and workflow ' +
      'analyses; up to 5 roundtrips). ' +
      'Prints gathered context even when no LLM is configured.',
    )
    .option('--guide-model-id <id>', 'embed_config.id of the guide model to use')
    .option('--model <name>', 'guide/narrator model name to use')
    .option('--no-context', 'skip gathering git context (faster but less accurate)')
    .option('-i, --interactive', 'start an interactive REPL session (one question per line)')
    .action(guideCommand)
}
