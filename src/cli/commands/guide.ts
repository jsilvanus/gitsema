/**
 * `gitsema guide` — interactive LLM chat with access to gitsema tools.
 *
 * The guide uses the active "guide" model config (kind='guide' in embed_config),
 * falling back to the active narrator model. It builds a context from gitsema
 * search results and recent git history, then asks the LLM to answer the
 * user's question.
 *
 * For multi-turn / function-call capable execution, see docs/chattydeer_contract.md.
 * The current implementation does a single context-enriched Q&A.
 *
 * Safe-by-default: if no guide or narrator model is configured the command
 * prints the gathered context without calling an LLM.
 */

import type { Command } from 'commander'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolveGuideProvider } from '../../core/narrator/resolveNarrator.js'
import { redactAll } from '../../core/narrator/redact.js'
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Context gathering helpers
// ---------------------------------------------------------------------------

interface GuideTool {
  name: string
  description: string
  call: (args: Record<string, string>) => string
}

/** Registry of built-in gitsema tools available to the guide. */
const GUIDE_TOOLS: GuideTool[] = [
  {
    name: 'recent_commits',
    description: 'Fetch the N most recent git commits (subject + hash + date)',
    call: ({ n = '20' }) => {
      try {
        return execSync(`git log --max-count=${n} --format="%H %ai %s"`, {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
        }).trim()
      } catch {
        return '(git log failed)'
      }
    },
  },
  {
    name: 'repo_stats',
    description: 'Basic repository statistics (branches, tags, total commits)',
    call: () => {
      try {
        const branches = execSync('git branch --list | wc -l', { encoding: 'utf8' }).trim()
        const tags = execSync('git tag --list | wc -l', { encoding: 'utf8' }).trim()
        const commits = execSync('git rev-list --count HEAD 2>/dev/null || echo 0', { encoding: 'utf8' }).trim()
        const remotes = execSync('git remote -v 2>/dev/null | head -4', { encoding: 'utf8' }).trim()
        return `Branches: ${branches}  Tags: ${tags}  Commits: ${commits}\nRemotes:\n${remotes}`
      } catch {
        return '(stats unavailable)'
      }
    },
  },
]

/** Gather quick context for the guide prompt. */
function gatherContext(question: string): string {
  const parts: string[] = []

  // Recent commits
  const recentTool = GUIDE_TOOLS.find((t) => t.name === 'recent_commits')!
  parts.push(`## Recent commits\n${recentTool.call({ n: '15' })}`)

  // Repo stats
  const statsTool = GUIDE_TOOLS.find((t) => t.name === 'repo_stats')!
  parts.push(`## Repository stats\n${statsTool.call({})}`)

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Core guide Q&A
// ---------------------------------------------------------------------------

export async function runGuide(question: string, opts: {
  guideModelId?: number
  model?: string
  includeContext?: boolean
}): Promise<{ answer: string; contextUsed: boolean; llmEnabled: boolean }> {
  const includeContext = opts.includeContext !== false

  // Build context
  const context = includeContext ? gatherContext(question) : ''

  // Resolve guide provider (guide model → narrator model → disabled)
  const provider = resolveGuideProvider({
    guideModelId: opts.guideModelId,
    modelName: opts.model,
  })

  try {
    if (!provider) {
      const answer = [
        '# Repository Context',
        '',
        context || '(no context gathered)',
        '',
        '---',
        '',
        `**Question:** ${question}`,
        '',
        '> No guide or narrator model configured. Run `gitsema models add-guide <name> --http-url <url> --activate` to enable LLM answers.',
      ].join('\n')
      return { answer, contextUsed: includeContext, llmEnabled: false }
    }

    // Build system + user prompt
    const systemPrompt = [
      'You are gitsema-guide, an expert assistant for the git repository the user is working in.',
      'You have access to repository context gathered by gitsema tools.',
      'Answer questions about the codebase, history, and development patterns.',
      'Always cite commit hashes when referencing specific changes.',
      'Be concise, factual, and mention when you are uncertain.',
    ].join('\n')

    const rawUserPrompt = context
      ? `Repository context:\n${context}\n\n---\n\nQuestion: ${question}`
      : `Question: ${question}`

    const { texts, firedPatterns } = redactAll([rawUserPrompt])
    const userPrompt = texts[0]
    if (firedPatterns.length > 0) {
      logger.info(`[guide] redacted ${firedPatterns.length} pattern(s) from prompt`)
    }

    const res = await provider.narrate({
      systemPrompt,
      userPrompt,
      maxTokens: 1024,
    })

    return { answer: res.prose, contextUsed: includeContext, llmEnabled: res.llmEnabled }
  } finally {
    await provider.destroy()
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

  // Interactive mode: read questions from stdin line-by-line
  if (opts.interactive || (!question && process.stdin.isTTY)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    console.log('gitsema guide — type your question (Ctrl-C or empty line to exit)\n')
    rl.prompt()
    rl.on('line', async (line) => {
      const q = line.trim()
      if (!q) { rl.close(); return }
      const { answer, llmEnabled } = await runGuide(q, { guideModelId, model: opts.model, includeContext })
      console.log(`\n${answer}\n`)
      if (!llmEnabled) {
        console.log('(No LLM model configured — showing context only.)\n')
      }
      rl.prompt()
    })
    rl.on('close', () => process.exit(0))
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
    console.error('\n(No LLM model configured — run `gitsema models add-guide <name> --http-url <url> --activate` to enable.)')
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
      'Uses the active guide model (or narrator model as fallback). ' +
      'Prints gathered context even when no LLM is configured.',
    )
    .option('--guide-model-id <id>', 'embed_config.id of the guide model to use')
    .option('--model <name>', 'guide/narrator model name to use')
    .option('--no-context', 'skip gathering git context (faster but less accurate)')
    .option('-i, --interactive', 'start an interactive REPL session (one question per line)')
    .action(guideCommand)
}
