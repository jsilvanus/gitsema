/**
 * CliNarratorProvider — NarratorProvider backed by a locally installed CLI AI
 * tool (e.g. Claude Code, Codex CLI, GitHub Copilot CLI).
 *
 * Instead of an HTTP call, the system+user prompt is combined and passed to
 * the configured CLI tool via `getCliAdapter(params.cliCommand)`, and the
 * tool's stdout is parsed back into prose.
 *
 * Safe-by-default: when `params` is undefined or `cliCommand` is unset,
 * `narrate()` returns immediately with a placeholder — no subprocess is
 * spawned.
 */

import { execFile } from 'node:child_process'
import type { NarratorProvider, NarrateRequest, NarrateResponse, CliNarratorParams } from './types.js'
import { getCliAdapter } from './cliAdapters.js'
import { redactPrompts, disabledNarratorResponse } from './providerCommon.js'
import { withAudit } from './audit.js'
import { logger } from '../../utils/logger.js'

const DEFAULT_TIMEOUT_MS = 60_000

export interface CliProviderOptions {
  modelName: string
  /** CLI narrator model params from the DB-backed config. Undefined → disabled. */
  params?: CliNarratorParams
}

const DISABLED_HINT =
  'configure a narrator model via: gitsema models add <name> --narrator --provider cli --cli-command <tool> --activate'

export class CliNarratorProvider implements NarratorProvider {
  readonly modelName: string
  private readonly _params: CliNarratorParams | undefined
  private readonly _enabled: boolean

  constructor(opts: CliProviderOptions) {
    this.modelName = opts.modelName
    this._params = opts.params
    this._enabled = !!opts.params?.cliCommand
  }

  async narrate(req: NarrateRequest): Promise<NarrateResponse> {
    const { redactedUser, redactedSystem, firedPatterns: allFired } = redactPrompts(req)

    if (!this._enabled || !this._params) {
      return disabledNarratorResponse(allFired, DISABLED_HINT)
    }

    const params = this._params
    const modelName = this.modelName

    const fn = async (): Promise<NarrateResponse> => {
      const adapter = getCliAdapter(params.cliCommand)
      const prompt = redactedSystem
        ? `${redactedSystem}\n\n---\n\n${redactedUser}`
        : redactedUser
      const args = adapter.buildOneShotArgs(prompt, params)
      const stdout = await runCli(params.cliCommand, args, params.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      const { prose } = adapter.parseOutput(stdout)

      return {
        prose,
        tokensUsed: 0,
        redactedFields: allFired,
        llmEnabled: true,
      }
    }

    try {
      return await withAudit('narrate', 'cli', modelName, allFired, fn)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[narrator] cli narrate failed: ${msg}`)
      return {
        prose: `(narrator error: ${msg})`,
        tokensUsed: 0,
        redactedFields: allFired,
        llmEnabled: true,
      }
    }
  }

  async destroy(): Promise<void> {
    // Provider holds no persistent resources — a subprocess is spawned per call.
  }
}

/**
 * Run a CLI tool with the given args, returning trimmed stdout.
 * Rejects on non-zero exit, spawn error, or timeout.
 */
export function runCli(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr?.trim() ? `: ${stderr.trim().slice(0, 200)}` : ''
        reject(new Error(`${command} failed${detail || `: ${err.message}`}`))
        return
      }
      resolve(stdout)
    })
  })
}

/**
 * Create a disabled-mode provider (safe-by-default, no subprocess spawned).
 */
export function createDisabledCliProvider(name = 'narrator'): CliNarratorProvider {
  return new CliNarratorProvider({ modelName: name })
}

/**
 * Create a provider from CLI narrator model params.
 */
export function createCliProvider(name: string, params: CliNarratorParams): CliNarratorProvider {
  return new CliNarratorProvider({ modelName: name, params })
}
