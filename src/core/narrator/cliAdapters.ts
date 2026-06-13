/**
 * CLI tool adapters for the `cli` narrator/guide provider.
 *
 * Each adapter knows how to build argv for a one-shot narration prompt and
 * (optionally) for an agentic "guide" turn that exposes gitsema's MCP server
 * to the CLI tool, plus how to parse the tool's stdout back into prose and an
 * optional session id for multi-turn resume.
 *
 * Adding support for a new CLI tool means adding one entry to `CLI_ADAPTERS`.
 */

import type { CliNarratorParams } from './types.js'

export interface CliGuideArgsOptions {
  /** Path to an MCP config file exposing gitsema's tools, if useMcp is set. */
  mcpConfigPath?: string
  /** Session id to resume from a prior turn, for multi-turn guide sessions. */
  resumeSessionId?: string
}

export interface CliParsedOutput {
  prose: string
  sessionId?: string
}

export interface CliAdapter {
  /** Build argv (excluding the executable itself) for a one-shot narration prompt. */
  buildOneShotArgs(prompt: string, params: CliNarratorParams): string[]
  /** Build argv (excluding the executable itself) for an agentic guide turn. */
  buildGuideArgs(prompt: string, params: CliNarratorParams, opts: CliGuideArgsOptions): string[]
  /** Extract prose (and optional session id) from the tool's stdout. */
  parseOutput(stdout: string): CliParsedOutput
}

// ---------------------------------------------------------------------------
// Claude Code CLI
// ---------------------------------------------------------------------------

const claudeAdapter: CliAdapter = {
  buildOneShotArgs(prompt, params) {
    return [...(params.cliArgs ?? []), '-p', prompt, '--output-format', 'json']
  },

  buildGuideArgs(prompt, params, opts) {
    const args = [...(params.cliArgs ?? []), '-p', prompt, '--output-format', 'json']
    if (params.useMcp && opts.mcpConfigPath) {
      args.push('--mcp-config', opts.mcpConfigPath, '--allowedTools', 'mcp__gitsema__*')
    }
    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId)
    }
    return args
  },

  parseOutput(stdout) {
    const trimmed = stdout.trim()
    try {
      const data = JSON.parse(trimmed) as { result?: string; session_id?: string }
      if (typeof data.result === 'string') {
        return { prose: data.result, sessionId: data.session_id }
      }
    } catch {
      // Not JSON — fall through to raw text.
    }
    return { prose: trimmed }
  },
}

// ---------------------------------------------------------------------------
// Codex CLI (OpenAI) — non-interactive `codex exec`.
//
// Codex configures MCP servers via its own config file rather than a CLI
// flag, so `useMcp` is currently a no-op for this adapter (best-effort /
// experimental). Session resume is not supported.
// ---------------------------------------------------------------------------

const codexAdapter: CliAdapter = {
  buildOneShotArgs(prompt, params) {
    return [...(params.cliArgs ?? []), 'exec', prompt]
  },

  buildGuideArgs(prompt, params, _opts) {
    return codexAdapter.buildOneShotArgs(prompt, params)
  },

  parseOutput(stdout) {
    return { prose: stdout.trim() }
  },
}

// ---------------------------------------------------------------------------
// GitHub Copilot CLI (`gh copilot`) — one-shot explain only.
//
// No MCP/tool-call support and no session resume; `useMcp` and
// `resumeSessionId` are ignored.
// ---------------------------------------------------------------------------

const copilotAdapter: CliAdapter = {
  buildOneShotArgs(prompt, params) {
    return [...(params.cliArgs ?? []), 'copilot', 'explain', prompt]
  },

  buildGuideArgs(prompt, params, _opts) {
    return copilotAdapter.buildOneShotArgs(prompt, params)
  },

  parseOutput(stdout) {
    return { prose: stdout.trim() }
  },
}

// ---------------------------------------------------------------------------
// Generic fallback — `<cliCommand> <...cliArgs> "<prompt>"`, raw stdout.
// ---------------------------------------------------------------------------

const genericAdapter: CliAdapter = {
  buildOneShotArgs(prompt, params) {
    return [...(params.cliArgs ?? []), prompt]
  },

  buildGuideArgs(prompt, params, _opts) {
    return genericAdapter.buildOneShotArgs(prompt, params)
  },

  parseOutput(stdout) {
    return { prose: stdout.trim() }
  },
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const CLI_ADAPTERS: Record<string, CliAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  copilot: copilotAdapter,
  gh: copilotAdapter,
}

/** Resolve the adapter for a given `cliCommand`, falling back to the generic adapter. */
export function getCliAdapter(cliCommand: string): CliAdapter {
  const base = cliCommand.split(/[\\/]/).pop() ?? cliCommand
  return CLI_ADAPTERS[base] ?? genericAdapter
}
