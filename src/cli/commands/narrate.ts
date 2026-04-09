/**
 * `gitsema narrate` and `gitsema explain` CLI command handlers.
 *
 * Both commands resolve the active narrator model config from the DB
 * (or via CLI override) and generate LLM-powered prose.
 *
 * Safe-by-default: when no narrator model is configured the commands print
 * a clear message without making any network calls.
 */

import type { Command } from 'commander'
import { resolveNarratorProvider, runNarrate, runExplain } from '../../core/narrator/index.js'
import type { NarrateFocus, NarrateFormat, NarrationResult } from '../../core/narrator/types.js'

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatResult(result: NarrationResult): string {
  // Evidence-only mode: just print the JSON (commits)
  if (result.evidence !== undefined) {
    return result.prose // already JSON-serialised by runNarrate/runExplain
  }

  const { prose, commitCount, citations, llmEnabled, format } = result

  if (!llmEnabled) {
    return prose
  }

  const lines: string[] = []

  if (format === 'json') {
    return JSON.stringify(
      {
        prose,
        commitCount,
        citations,
        redactedFields: result.redactedFields,
        llmEnabled,
      },
      null,
      2,
    )
  }

  if (format === 'md') {
    lines.push(`## Narrative`)
    lines.push('')
    lines.push(prose)
    lines.push('')
    if (citations.length > 0) {
      lines.push(`### Cited commits (${citations.length})`)
      lines.push(citations.slice(0, 20).map((h) => `- \`${h.slice(0, 12)}\``).join('\n'))
    }
    lines.push('')
    lines.push(`_${commitCount} commit(s) analysed_`)
    if (result.redactedFields.length > 0) {
      lines.push(`_Redacted patterns: ${result.redactedFields.join(', ')}_`)
    }
  } else {
    // text
    lines.push(prose)
    lines.push('')
    if (citations.length > 0) {
      lines.push(`Cited commits: ${citations.slice(0, 20).map((h) => h.slice(0, 12)).join(', ')}`)
    }
    lines.push(`${commitCount} commit(s) analysed`)
    if (result.redactedFields.length > 0) {
      lines.push(`Redacted patterns: ${result.redactedFields.join(', ')}`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// narrate command
// ---------------------------------------------------------------------------

export async function narrateCommand(
  opts: {
    since?: string
    until?: string
    range?: string
    focus?: string
    format?: string
    maxCommits?: string
    narratorModelId?: string
    model?: string
    narrate?: boolean
    evidenceOnly?: boolean
  },
): Promise<void> {
  // --narrate is shorthand for --no-evidence-only; default is evidence-only
  const evidenceOnly = opts.narrate ? false : (opts.evidenceOnly !== false)
  const narratorModelId = opts.narratorModelId !== undefined ? parseInt(opts.narratorModelId, 10) : undefined
  const provider = resolveNarratorProvider({
    narratorModelId,
    modelName: opts.model,
  })

  let result: NarrationResult
  try {
    result = await runNarrate(provider, {
      since: opts.since,
      until: opts.until,
      range: opts.range,
      focus: (opts.focus as NarrateFocus) ?? 'all',
      format: (opts.format as NarrateFormat) ?? 'md',
      maxCommits: opts.maxCommits ? parseInt(opts.maxCommits, 10) : undefined,
      evidenceOnly,
    })
  } finally {
    await provider.destroy()
  }

  console.log(formatResult(result))
}

// ---------------------------------------------------------------------------
// explain command
// ---------------------------------------------------------------------------

export async function explainCommand(
  topic: string,
  opts: {
    since?: string
    until?: string
    log?: string
    files?: string
    format?: string
    narratorModelId?: string
    model?: string
    narrate?: boolean
    evidenceOnly?: boolean
  },
): Promise<void> {
  // --narrate is shorthand for --no-evidence-only; default is evidence-only
  const evidenceOnly = opts.narrate ? false : (opts.evidenceOnly !== false)
  const narratorModelId = opts.narratorModelId !== undefined ? parseInt(opts.narratorModelId, 10) : undefined
  const provider = resolveNarratorProvider({
    narratorModelId,
    modelName: opts.model,
  })

  let result: NarrationResult
  try {
    result = await runExplain(provider, topic, {
      since: opts.since,
      until: opts.until,
      log: opts.log,
      files: opts.files,
      format: (opts.format as NarrateFormat) ?? 'md',
      evidenceOnly,
    })
  } finally {
    await provider.destroy()
  }

  console.log(formatResult(result))
}

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

export function registerNarratorCommands(program: Command): void {
  program
    .command('narrate')
    .description('Return commit evidence (default) or an LLM-generated narrative of repository development history.')
    .option('--since <ref|date>', 'only include commits after this ref or date')
    .option('--until <ref|date>', 'only include commits before this ref or date')
    .option('--range <rev-range>', 'git revision range (e.g. v1.0..HEAD)')
    .option(
      '--focus <area>',
      'filter commits by area: bugs, features, ops, security, deps, performance, all (default: all)',
      'all',
    )
    .option('--format <fmt>', 'output format when narrating: md, text, json (default: md)', 'md')
    .option('--max-commits <n>', 'maximum commits to analyse (default: 500)')
    .option('--narrator-model-id <id>', 'embed_config.id of the narrator model to use (overrides active selection)')
    .option('--model <name>', 'narrator model name to use (overrides active selection)')
    .option('--narrate', 'call the LLM narrator and return prose (default: return evidence only)')
    .option('--evidence-only', 'return raw commit evidence without calling the LLM (this is the default)')
    .action(narrateCommand)

  program
    .command('explain <topic>')
    .description('Return matching commits (default) or an LLM-generated timeline for a bug, error, or topic.')
    .option('--since <ref|date>', 'only include commits after this ref or date')
    .option('--until <ref|date>', 'only include commits before this ref or date')
    .option('--log <path>', 'path to an error log or stack trace file to include as context')
    .option('--files <glob>', 'restrict search to files matching this glob')
    .option('--format <fmt>', 'output format when narrating: md, text, json (default: md)', 'md')
    .option('--narrator-model-id <id>', 'embed_config.id of the narrator model to use (overrides active selection)')
    .option('--model <name>', 'narrator model name to use (overrides active selection)')
    .option('--narrate', 'call the LLM narrator and return prose (default: return evidence only)')
    .option('--evidence-only', 'return raw matching commits without calling the LLM (this is the default)')
    .action(explainCommand)
}
