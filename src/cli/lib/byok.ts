import type { Command } from 'commander'
import type { ByokCredentials } from '../../core/narrator/types.js'

/**
 * The shared `--byok-*` flag set (Phase 130 / locked-model-set-plan.md §5
 * Phase 3): request-scoped narrator/guide LLM credentials that bypass the
 * configured/allow-listed model entirely and are never persisted.
 */
export function addByokOptions(cmd: Command, label: string): Command {
  return cmd
    .option('--byok-http-url <url>', `request-scoped ${label} LLM endpoint (bring-your-own-key; bypasses configured/allow-listed models, never persisted)`)
    .option('--byok-api-key <key>', 'bearer token for --byok-http-url')
    .option('--byok-model <name>', 'model id sent to --byok-http-url (defaults to the endpoint default)')
    .option('--byok-max-tokens <n>', 'max tokens per BYOK call')
    .option('--byok-temperature <n>', 'temperature for BYOK calls')
}

/** Parses the CLI's string-typed `--byok-*` opts into `ByokCredentials`. */
export function parseByokCliOpts(opts: {
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
