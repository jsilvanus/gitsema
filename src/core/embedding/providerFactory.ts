/**
 * Shared embedding provider factory.
 *
 * Centralises the repeated `buildProvider` pattern that was previously
 * copy-pasted into every CLI command file and the MCP server.
 *
 * Consumers (CLI commands, MCP server, HTTP server) are responsible for
 * catching the `Error` thrown by `buildProvider` and converting it into the
 * appropriate exit/response strategy for their runtime context.
 */

import { OllamaProvider } from './local.js'
import { HttpProvider } from './http.js'
import { BatchingProvider } from './batching.js'
import type { EmbeddingProvider } from './provider.js'

/**
 * Constructs an EmbeddingProvider from explicit type and model values.
 *
 * @throws {Error} When `type === 'http'` but `GITSEMA_HTTP_URL` is not set.
 */
export function buildProvider(type: string, model: string): EmbeddingProvider {
  if (type === 'http') {
    const baseUrl = process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      throw new Error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
    }
    return new HttpProvider({ baseUrl, model, apiKey: process.env.GITSEMA_API_KEY })
  }
  return new OllamaProvider({ model })
}

/**
 * Like `buildProvider`, but wraps the result in a `BatchingProvider` that
 * splits large `embedBatch()` calls into sub-batches and adds per-sub-batch
 * retry with exponential back-off.
 *
 * The `maxSubBatchSize` governs the maximum texts per sub-batch call; when
 * omitted it defaults to 32.
 *
 * @throws {Error} When `type === 'http'` but `GITSEMA_HTTP_URL` is not set.
 */
export function buildBatchingProvider(
  type: string,
  model: string,
  maxSubBatchSize?: number,
): EmbeddingProvider {
  const inner = buildProvider(type, model)
  return new BatchingProvider(inner, { maxSubBatchSize })
}

/**
 * Returns a text-oriented EmbeddingProvider based on environment variables.
 *
 * Resolution order: `GITSEMA_TEXT_MODEL` → `GITSEMA_MODEL` → `nomic-embed-text`
 *
 * @throws {Error} When `GITSEMA_PROVIDER=http` but `GITSEMA_HTTP_URL` is not set.
 */
export function getTextProvider(): EmbeddingProvider {
  const type = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model =
    process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  return buildProvider(type, model)
}

/**
 * Returns a code-oriented EmbeddingProvider based on environment variables.
 *
 * Resolution order: `GITSEMA_CODE_MODEL` → `GITSEMA_TEXT_MODEL` → `GITSEMA_MODEL` → `nomic-embed-text`
 *
 * @throws {Error} When `GITSEMA_PROVIDER=http` but `GITSEMA_HTTP_URL` is not set.
 */
export function getCodeProvider(): EmbeddingProvider {
  const type = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model =
    process.env.GITSEMA_CODE_MODEL ??
    process.env.GITSEMA_TEXT_MODEL ??
    process.env.GITSEMA_MODEL ??
    'nomic-embed-text'
  return buildProvider(type, model)
}

/**
 * Applies CLI model option overrides to process.env so that downstream
 * provider factory functions (getTextProvider / getCodeProvider) pick them up.
 * Only overrides vars that are not already set by the user's shell environment
 * (i.e., vars that were set by applyConfigToEnv from a config file are overridden).
 *
 * --model sets both GITSEMA_TEXT_MODEL and GITSEMA_CODE_MODEL unless
 *   --text-model or --code-model are also given.
 */
export function applyModelOverrides(opts: {
  model?: string
  textModel?: string
  codeModel?: string
}): void {
  if (opts.model) {
    process.env.GITSEMA_MODEL = opts.model
    if (!opts.textModel) process.env.GITSEMA_TEXT_MODEL = opts.model
    if (!opts.codeModel) process.env.GITSEMA_CODE_MODEL = opts.model
  }
  if (opts.textModel) process.env.GITSEMA_TEXT_MODEL = opts.textModel
  if (opts.codeModel) process.env.GITSEMA_CODE_MODEL = opts.codeModel
}
