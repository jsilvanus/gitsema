/**
 * Shared exit-code constants and actionable error-message helpers for CLI commands.
 *
 * Exit code contract:
 *   EXIT_OK          (0) — success
 *   EXIT_RUNTIME     (1) — runtime error (provider unreachable, no index, I/O failure, etc.)
 *   EXIT_USAGE       (2) — invalid user input/arguments
 *   EXIT_GATE_FAILED (3) — CI-gate check failed (drift/policy/regression detected)
 */

export const EXIT_OK = 0
export const EXIT_RUNTIME = 1
export const EXIT_USAGE = 2
export const EXIT_GATE_FAILED = 3

/**
 * Message shown when an operation requires an index that hasn't been built yet.
 */
export function indexMissingHint(dbPath = '.gitsema/index.db'): string {
  return `No index found at ${dbPath}. Run \`gitsema index\` first.`
}

/**
 * Message shown when the embedding provider could not be reached or constructed.
 * Points the user at `gitsema doctor` / `gitsema quickstart` and the relevant env vars.
 */
export function providerUnreachableHint(provider: string, url?: string): string {
  const lines = [
    `Could not reach the embedding provider (${provider}${url ? ` at ${url}` : ''}).`,
    'Run `gitsema doctor` to diagnose, or `gitsema quickstart` to set up a provider.',
    'Check GITSEMA_PROVIDER and GITSEMA_HTTP_URL (or that Ollama is running) and try again.',
  ]
  return lines.join('\n')
}
