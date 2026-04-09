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
import { EmbedeerProvider } from './embedeer.js'
import { BatchingProvider } from './batching.js'
import { PrefixedProvider } from './prefixedProvider.js'
import type { EmbeddingProvider } from './provider.js'
import { getModelProfile, type ModelProfile } from '../config/configManager.js'
import { getFileCategory } from './fileType.js'
import { extname } from 'node:path'

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
  if (type === 'embedeer') {
    return new EmbedeerProvider({ model })
  }
  return new OllamaProvider({ model })
}

/**
 * Constructs an EmbeddingProvider for a named model, respecting per-model
 * provider profiles (set via `gitsema models add <name>`).
 *
 * Resolution order for each setting:
 *   per-model config (local) > per-model config (global) > env vars > defaults
 *
 * @throws {Error} When the resolved provider is "http" but no URL is available.
 */
export function buildProviderForModel(modelName: string): EmbeddingProvider {
  const profile = getModelProfile(modelName)
  const type = profile.provider ?? process.env.GITSEMA_PROVIDER ?? 'ollama'
  if (type === 'http') {
    const baseUrl = profile.httpUrl ?? process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      throw new Error(
        `HTTP URL required for model '${modelName}'. ` +
        `Set it with: gitsema models add ${modelName} --provider http --url <url>`,
      )
    }
    const apiKey = profile.apiKey ?? process.env.GITSEMA_API_KEY
    return new HttpProvider({ baseUrl, model: modelName, apiKey })
  }
  if (type === 'embedeer') {
    return new EmbedeerProvider({ model: modelName })
  }
  return new OllamaProvider({ model: modelName })
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
 * Resolves the embedding prefix for a specific file path given a model profile.
 *
 * Resolution order:
 *   1. `profile.extRoles[ext]` → role name → `profile.prefixes[role]`
 *   2. Built-in file category (`code` | `text` | `other`) → `profile.prefixes[category]`
 *   3. `undefined` if no prefix is configured for the resolved role/category
 */
export function getPrefixForFile(filePath: string, profile: ModelProfile): string | undefined {
  if (!profile.prefixes) return undefined
  const ext = extname(filePath).toLowerCase()
  const role = profile.extRoles?.[ext] ?? getFileCategory(filePath)
  return profile.prefixes[role]
}

/**
 * Wraps `provider` in a `PrefixedProvider` if `prefix` is a non-empty string.
 * Returns `provider` unchanged when no prefix is needed.
 */
function maybePrefix(provider: EmbeddingProvider, prefix: string | undefined): EmbeddingProvider {
  return prefix ? new PrefixedProvider(provider, prefix) : provider
}

/**
 * Returns a text-oriented EmbeddingProvider based on environment variables
 * and per-model profile (if configured for the resolved model name).
 *
 * Resolution order: `GITSEMA_TEXT_MODEL` → `GITSEMA_MODEL` → `nomic-embed-text`
 *
 * If the model profile configures a "text" prefix, the returned provider
 * automatically prepends it to every embed call.
 *
 * @throws {Error} When the resolved provider is "http" but no URL is available.
 */
export function getTextProvider(): EmbeddingProvider {
  const model =
    process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const profile = getModelProfile(model)
  const type = profile.provider ?? process.env.GITSEMA_PROVIDER ?? 'ollama'
  let inner: EmbeddingProvider
  if (type === 'http') {
    const baseUrl = profile.httpUrl ?? process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      throw new Error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
    }
    inner = new HttpProvider({ baseUrl, model, apiKey: profile.apiKey ?? process.env.GITSEMA_API_KEY })
  } else if (type === 'embedeer') {
    inner = new EmbedeerProvider({ model })
  } else {
    inner = new OllamaProvider({ model })
  }
  return maybePrefix(inner, profile.prefixes?.['text'])
}

/**
 * Returns a code-oriented EmbeddingProvider based on environment variables
 * and per-model profile (if configured for the resolved model name).
 *
 * Resolution order: `GITSEMA_CODE_MODEL` → `GITSEMA_TEXT_MODEL` → `GITSEMA_MODEL` → `nomic-embed-text`
 *
 * If the model profile configures a "code" prefix, the returned provider
 * automatically prepends it to every embed call.
 *
 * @throws {Error} When the resolved provider is "http" but no URL is available.
 */
export function getCodeProvider(): EmbeddingProvider {
  const model =
    process.env.GITSEMA_CODE_MODEL ??
    process.env.GITSEMA_TEXT_MODEL ??
    process.env.GITSEMA_MODEL ??
    'nomic-embed-text'
  const profile = getModelProfile(model)
  const type = profile.provider ?? process.env.GITSEMA_PROVIDER ?? 'ollama'
  let inner: EmbeddingProvider
  if (type === 'http') {
    const baseUrl = profile.httpUrl ?? process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      throw new Error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
    }
    inner = new HttpProvider({ baseUrl, model, apiKey: profile.apiKey ?? process.env.GITSEMA_API_KEY })
  } else if (type === 'embedeer') {
    inner = new EmbedeerProvider({ model })
  } else {
    inner = new OllamaProvider({ model })
  }
  return maybePrefix(inner, profile.prefixes?.['code'])
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
