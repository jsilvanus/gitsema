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
import { writeFileSync } from 'node:fs'
import { resolveNarratorProvider } from '../../core/narrator/resolveNarrator.js'
import { runNarrate, runExplain } from '../../core/narrator/narrator.js'
import type { ByokCredentials, NarrateFocus, NarrateFormat, NarrationResult } from '../../core/narrator/types.js'
import { resolveOutputs, getSink, collectOut, type OutputSpec } from '../../utils/outputSink.js'
import { addLensOption, parseLens } from '../lib/lens.js'

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
// --out / --format resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective NarrateFormat and an optional output sink from the
 * unified `--out <spec>` option, falling back to the legacy `--format` flag.
 *
 * `--out` formats map onto NarrateFormat as: json -> json, markdown -> md,
 * text/html -> text. When `--out` specifies a file, the result is written
 * there instead of stdout.
 */
function resolveNarrateOutput(opts: { out?: string[]; format?: string }): {
  format: NarrateFormat
  sink?: OutputSpec
} {
  if (opts.out && opts.out.length > 0) {
    const sinks = resolveOutputs({ out: opts.out })
    const jsonSink = getSink(sinks, 'json')
    const markdownSink = getSink(sinks, 'markdown')
    const textSink = getSink(sinks, 'text')
    const sink = jsonSink ?? markdownSink ?? textSink ?? sinks[0]
    const format: NarrateFormat = jsonSink ? 'json' : markdownSink ? 'md' : 'text'
    return { format, sink }
  }
  return { format: (opts.format as NarrateFormat) ?? 'md' }
}

/**
 * Build request-scoped BYOK credentials from CLI flags (Phase 130 /
 * locked-model-set-plan.md §5 Phase 3). Returns undefined unless
 * `--byok-http-url` is set, leaving normal DB-backed resolution untouched.
 */
function parseByok(opts: {
  byokHttpUrl?: string
  byokApiKey?: string
  byokModel?: string
  byokMaxTokens?: string
  byokTemperature?: string
}): ByokCredentials | undefined {
  if (!opts.byokHttpUrl) return undefined
  return {
    httpUrl: opts.byokHttpUrl,
    ...(opts.byokApiKey ? { apiKey: opts.byokApiKey } : {}),
    ...(opts.byokModel ? { model: opts.byokModel } : {}),
    ...(opts.byokMaxTokens ? { maxTokens: parseInt(opts.byokMaxTokens, 10) } : {}),
    ...(opts.byokTemperature ? { temperature: parseFloat(opts.byokTemperature) } : {}),
  }
}

/** Emit a formatted narration result to its resolved sink (file or stdout). */
function emitNarrateResult(result: NarrationResult, sink: OutputSpec | undefined): void {
  const text = formatResult(result)
  if (sink?.file) {
    writeFileSync(sink.file, text, 'utf8')
    console.log(`Output written to ${sink.file}`)
    return
  }
  console.log(text)
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
    out?: string[]
    byokHttpUrl?: string
    byokApiKey?: string
    byokModel?: string
    byokMaxTokens?: string
    byokTemperature?: string
  },
): Promise<void> {
  // --narrate is shorthand for --no-evidence-only; default is evidence-only
  const evidenceOnly = opts.narrate ? false : (opts.evidenceOnly !== false)
  const narratorModelId = opts.narratorModelId !== undefined ? parseInt(opts.narratorModelId, 10) : undefined
  const provider = resolveNarratorProvider({
    narratorModelId,
    modelName: opts.model,
    byok: parseByok(opts),
  })

  const { format, sink } = resolveNarrateOutput(opts)

  let result: NarrationResult
  try {
    result = await runNarrate(provider, {
      since: opts.since,
      until: opts.until,
      range: opts.range,
      focus: (opts.focus as NarrateFocus) ?? 'all',
      format,
      maxCommits: opts.maxCommits ? parseInt(opts.maxCommits, 10) : undefined,
      evidenceOnly,
    })
  } finally {
    await provider.destroy()
  }

  emitNarrateResult(result, sink)
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
    out?: string[]
    byokHttpUrl?: string
    byokApiKey?: string
    byokModel?: string
    byokMaxTokens?: string
    byokTemperature?: string
    /** Phase 111 lens toggle. Default `semantic` keeps output byte-identical. */
    lens?: string
  },
): Promise<void> {
  // --narrate is shorthand for --no-evidence-only; default is evidence-only
  const evidenceOnly = opts.narrate ? false : (opts.evidenceOnly !== false)
  const narratorModelId = opts.narratorModelId !== undefined ? parseInt(opts.narratorModelId, 10) : undefined
  const provider = resolveNarratorProvider({
    narratorModelId,
    modelName: opts.model,
    byok: parseByok(opts),
  })

  const { format, sink } = resolveNarrateOutput(opts)

  let result: NarrationResult
  try {
    result = await runExplain(provider, topic, {
      since: opts.since,
      until: opts.until,
      log: opts.log,
      files: opts.files,
      format,
      evidenceOnly,
    })
  } finally {
    await provider.destroy()
  }

  emitNarrateResult(result, sink)

  // Structural enrichment (Phase 110/111): when a structural/hybrid lens is
  // requested and a concrete `--files` path is given, append grounded
  // call-graph / co-change context. Default `semantic` lens prints nothing
  // extra, so existing output stays byte-identical. Skipped for JSON output to
  // avoid corrupting the payload.
  const lens = parseLens(opts.lens, 'semantic')
  if (lens !== 'semantic' && opts.files && format !== 'json' && !sink?.file) {
    try {
      const { getCachedStorageProfile } = await import('../../core/storage/resolveProfile.js')
      const { structuralContextForPath, formatStructuralContext } = await import('../../core/graph/structuralContext.js')
      const graph = getCachedStorageProfile(process.cwd()).graph
      const ctx = await structuralContextForPath(graph, opts.files)
      const summary = formatStructuralContext(ctx)
      if (summary) {
        console.log(`\nStructural context [lens: ${lens}] for ${opts.files}: ${summary}`)
      }
    } catch {
      // graph unavailable — skip enrichment silently
    }
  }
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
    .option('--format <fmt>', 'output format when narrating: md, text, json (default: md) (legacy: prefer --out)', 'md')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|markdown[:file] (overrides --format)', collectOut, [] as string[])
    .option('--max-commits <n>', 'maximum commits to analyse (default: 500)')
    .option('--narrator-model-id <id>', 'embed_config.id of the narrator model to use (overrides active selection)')
    .option('--model <name>', 'narrator model name to use (overrides active selection)')
    .option('--narrate', 'call the LLM narrator and return prose (default: return evidence only)')
    .option('--evidence-only', 'return raw commit evidence without calling the LLM (this is the default)')
    .option('--byok-http-url <url>', 'request-scoped narrator LLM endpoint (bring-your-own-key; bypasses configured/allow-listed models, never persisted)')
    .option('--byok-api-key <key>', 'bearer token for --byok-http-url')
    .option('--byok-model <name>', 'model id sent to --byok-http-url (defaults to the endpoint default)')
    .option('--byok-max-tokens <n>', 'max tokens per BYOK call')
    .option('--byok-temperature <n>', 'temperature for BYOK calls')
    .action(narrateCommand)

  addLensOption(
    program
      .command('explain <topic>')
      .description('Return matching commits (default) or an LLM-generated timeline for a bug, error, or topic.')
      .option('--since <ref|date>', 'only include commits after this ref or date')
      .option('--until <ref|date>', 'only include commits before this ref or date')
      .option('--log <path>', 'path to an error log or stack trace file to include as context')
      .option('--files <glob>', 'restrict search to files matching this glob')
      .option('--format <fmt>', 'output format when narrating: md, text, json (default: md) (legacy: prefer --out)', 'md')
      .option('--out <spec>', 'output spec (repeatable): text|json[:file]|markdown[:file] (overrides --format)', collectOut, [] as string[])
      .option('--narrator-model-id <id>', 'embed_config.id of the narrator model to use (overrides active selection)')
      .option('--model <name>', 'narrator model name to use (overrides active selection)')
      .option('--narrate', 'call the LLM narrator and return prose (default: return evidence only)')
      .option('--evidence-only', 'return raw matching commits without calling the LLM (this is the default)')
      .option('--byok-http-url <url>', 'request-scoped narrator LLM endpoint (bring-your-own-key; bypasses configured/allow-listed models, never persisted)')
      .option('--byok-api-key <key>', 'bearer token for --byok-http-url')
      .option('--byok-model <name>', 'model id sent to --byok-http-url (defaults to the endpoint default)')
      .option('--byok-max-tokens <n>', 'max tokens per BYOK call')
      .option('--byok-temperature <n>', 'temperature for BYOK calls'),
    'semantic',
  ).action(explainCommand)
}
