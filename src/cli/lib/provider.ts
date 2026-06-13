/**
 * Shared embedding-provider construction and model-resolution helpers for CLI commands.
 *
 * Consolidates the `buildProviderOrExit` function that was copy-pasted across ~14
 * command files, the `applyModelOverrides` + env-fallback chain used to resolve the
 * text/code model names, and an Ollama reachability probe extracted from `quickstart`.
 */

import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'

/**
 * Build an embedding provider, printing an `Error: ...` message and exiting the
 * process with the given code if construction fails (e.g. missing GITSEMA_HTTP_URL).
 *
 * `process.exit` never returns, but is typed as returning `never` only when no
 * value is needed — keep an explicit `throw` after it so this function's return
 * type can remain `EmbeddingProvider` (not `EmbeddingProvider | undefined`) for
 * callers that don't perform additional control-flow analysis.
 */
export function buildProviderOrExit(
  providerType: string,
  model: string,
  exitCode = 1,
): EmbeddingProvider {
  try {
    return buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(exitCode)
    throw err
  }
}

export interface ModelOverrideOptions {
  model?: string
  textModel?: string
  codeModel?: string
}

export interface ResolvedModels {
  providerType: string
  /** Model used for natural-language queries / prose. */
  textModel: string
  /** Model used for source-code content. Defaults to `textModel` when not overridden. */
  codeModel: string
}

/**
 * Apply CLI `--model` / `--text-model` / `--code-model` overrides to the process
 * environment (via `applyModelOverrides`) and resolve the effective provider type,
 * text model, and code model using the standard env-var fallback chain:
 *
 *   GITSEMA_TEXT_MODEL ?? GITSEMA_MODEL ?? 'nomic-embed-text'
 *   GITSEMA_CODE_MODEL ?? <textModel>
 */
export function resolveModels(options: ModelOverrideOptions): ResolvedModels {
  applyModelOverrides({
    model: options.model,
    textModel: options.textModel,
    codeModel: options.codeModel,
  })

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel

  return { providerType, textModel, codeModel }
}

/**
 * Probe whether an Ollama-compatible server is reachable at `url` by hitting
 * `/api/tags` with a short timeout. Returns `true` if the server responds with
 * an OK status, `false` on any error, non-OK response, or timeout.
 */
export async function probeOllama(url = 'http://localhost:11434', timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resp = await fetch(`${url}/api/tags`, { signal: controller.signal })
      return resp.ok
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return false
  }
}

/**
 * List model names available on an Ollama server by querying `/api/tags`.
 * Returns an empty array on any error, non-OK response, or timeout.
 */
export async function listOllamaModels(url = 'http://localhost:11434', timeoutMs = 2000): Promise<string[]> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resp = await fetch(`${url}/api/tags`, { signal: controller.signal })
      if (!resp.ok) return []
      const data = await resp.json() as { models?: Array<{ name?: string }> }
      return (data.models ?? []).map((m) => m.name).filter((n): n is string => !!n)
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return []
  }
}
