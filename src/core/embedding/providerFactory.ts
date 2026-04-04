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
