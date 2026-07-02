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

// ---------------------------------------------------------------------------
// ResolvedConfig — explicit configuration object
// ---------------------------------------------------------------------------

/**
 * Explicit configuration object that can be passed to provider factory
 * functions instead of relying on `process.env`. When provided, the factory
 * reads all settings from this object rather than env vars.
 *
 * CLI commands build a `ResolvedConfig` from env vars + config file at the
 * boundary and pass it down — keeping the core free of `process.env` reads.
 */
export interface ResolvedConfig {
  provider?: string
  model?: string
  textModel?: string
  codeModel?: string
  httpUrl?: string
  apiKey?: string
}

/**
 * Builds a `ResolvedConfig` from the current `process.env` state.
 * Use this at the CLI/server boundary to capture env state once and pass the
 * resulting object into core functions.
 */
export function resolveConfigFromEnv(): ResolvedConfig {
  return {
    provider: process.env.GITSEMA_PROVIDER,
    model: process.env.GITSEMA_MODEL,
    textModel: process.env.GITSEMA_TEXT_MODEL,
    codeModel: process.env.GITSEMA_CODE_MODEL,
    httpUrl: process.env.GITSEMA_HTTP_URL,
    apiKey: process.env.GITSEMA_API_KEY,
  }
}

// ---------------------------------------------------------------------------
// Helpers to read config fields with env-var fallback
// ---------------------------------------------------------------------------

function cfgProvider(config?: ResolvedConfig): string | undefined {
  return config?.provider ?? process.env.GITSEMA_PROVIDER
}
function cfgHttpUrl(config?: ResolvedConfig): string | undefined {
  return config?.httpUrl ?? process.env.GITSEMA_HTTP_URL
}
function cfgApiKey(config?: ResolvedConfig): string | undefined {
  return config?.apiKey ?? process.env.GITSEMA_API_KEY
}

/**
 * Constructs an EmbeddingProvider from explicit type and model values.
 *
 * @param config - Optional explicit config. Falls back to `process.env` when omitted.
 * @throws {Error} When `type === 'http'` but no HTTP URL is available.
 */
export function buildProvider(type: string, model: string, config?: ResolvedConfig): EmbeddingProvider {
  if (type === 'http') {
    const baseUrl = cfgHttpUrl(config)
    if (!baseUrl) {
      throw new Error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
    }
    return new HttpProvider({ baseUrl, model, apiKey: cfgApiKey(config) })
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
 * @param config - Optional explicit config. Falls back to `process.env` when omitted.
 * @throws {Error} When the resolved provider is "http" but no URL is available.
 */
export function buildProviderForModel(modelName: string, config?: ResolvedConfig): EmbeddingProvider {
  const profile = getModelProfile(modelName)
  const resolvedModel = profile.globalName ?? modelName
  const type = profile.provider ?? cfgProvider(config) ?? 'ollama'
  if (type === 'http') {
    const baseUrl = profile.httpUrl ?? cfgHttpUrl(config)
    if (!baseUrl) {
      throw new Error(
        `HTTP URL required for model '${modelName}'. ` +
        `Set it with: gitsema models add ${modelName} --provider http --url <url>`,
      )
    }
    const apiKey = profile.apiKey ?? cfgApiKey(config)
    return new HttpProvider({ baseUrl, model: resolvedModel, apiKey })
  }
  if (type === 'embedeer') {
    return new EmbedeerProvider({ model: resolvedModel })
  }
  return new OllamaProvider({ model: resolvedModel })
}

/**
 * Like `buildProvider`, but wraps the result in a `BatchingProvider` that
 * splits large `embedBatch()` calls into sub-batches and adds per-sub-batch
 * retry with exponential back-off.
 *
 * @param config - Optional explicit config. Falls back to `process.env` when omitted.
 * @throws {Error} When `type === 'http'` but no HTTP URL is available.
 */
export function buildBatchingProvider(
  type: string,
  model: string,
  maxSubBatchSize?: number,
  config?: ResolvedConfig,
): EmbeddingProvider {
  const inner = buildProvider(type, model, config)
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
 * Shared implementation for building a provider from a resolved model name
 * and an optional role prefix. Both `getTextProvider` and `getCodeProvider`
 * delegate to this to avoid duplicated if/else chains.
 *
 * @param modelName - The resolved model name (after env var cascade)
 * @param role - The role key for prefix lookup in the profile (e.g. 'text', 'code')
 * @param config - Optional explicit config. Falls back to `process.env` when omitted.
 * @throws {Error} When the resolved provider is "http" but no URL is available.
 */
function buildFromProfile(modelName: string, role: string, config?: ResolvedConfig): EmbeddingProvider {
  const profile = getModelProfile(modelName)
  const resolvedModel = profile.globalName ?? modelName
  const type = profile.provider ?? cfgProvider(config) ?? 'ollama'
  let inner: EmbeddingProvider
  if (type === 'http') {
    const baseUrl = profile.httpUrl ?? cfgHttpUrl(config)
    if (!baseUrl) {
      throw new Error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
    }
    inner = new HttpProvider({ baseUrl, model: resolvedModel, apiKey: profile.apiKey ?? cfgApiKey(config) })
  } else if (type === 'embedeer') {
    inner = new EmbedeerProvider({ model: resolvedModel })
  } else {
    inner = new OllamaProvider({ model: resolvedModel })
  }
  return maybePrefix(inner, profile.prefixes?.[role])
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
 * @param config - Optional explicit config. Falls back to `process.env` when omitted.
 * @throws {Error} When the resolved provider is "http" but no URL is available.
 */
export function getTextProvider(config?: ResolvedConfig): EmbeddingProvider {
  const model =
    config?.textModel ?? config?.model ??
    process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  return buildFromProfile(model, 'text', config)
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
 * @param config - Optional explicit config. Falls back to `process.env` when omitted.
 * @throws {Error} When the resolved provider is "http" but no URL is available.
 */
export function getCodeProvider(config?: ResolvedConfig): EmbeddingProvider {
  const model =
    config?.codeModel ?? config?.textModel ?? config?.model ??
    process.env.GITSEMA_CODE_MODEL ??
    process.env.GITSEMA_TEXT_MODEL ??
    process.env.GITSEMA_MODEL ??
    'nomic-embed-text'
  return buildFromProfile(model, 'code', config)
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

// ---------------------------------------------------------------------------
// Per-request model overrides (MCP/HTTP, Phase 138)
// ---------------------------------------------------------------------------

export interface ModelOverrideParams {
  model?: string
  textModel?: string
  codeModel?: string
}

/**
 * Returns `true` when at least one of `model`/`textModel`/`codeModel` is
 * set — the signal long-running server processes (MCP stdio server, HTTP
 * `tools serve`) use to decide whether a request needs its own provider
 * instances at all, versus reusing the process-wide default built once at
 * startup. Unlike CLI's `applyModelOverrides()`, none of this mutates
 * `process.env`: a long-running server handles requests concurrently, so
 * per-request overrides must not leak into other in-flight requests.
 */
export function hasModelOverride(params: ModelOverrideParams): boolean {
  return !!(params.model || params.textModel || params.codeModel)
}

/**
 * Builds a text- or code-role `EmbeddingProvider` for one request, honoring
 * `override` on top of the ambient `process.env`/config-file state (same
 * resolution order `getTextProvider`/`getCodeProvider` already apply).
 * `role: 'code'` returns `undefined` when neither a code-specific override
 * nor a general `model` override is given and the caller has no code
 * provider configured — preserving single-model mode instead of forcing a
 * redundant identical provider into existence.
 */
export function buildProviderForRequest(override: ModelOverrideParams, role: 'text', hasExistingCodeProvider?: boolean): EmbeddingProvider
export function buildProviderForRequest(override: ModelOverrideParams, role: 'code', hasExistingCodeProvider: boolean): EmbeddingProvider | undefined
export function buildProviderForRequest(
  override: ModelOverrideParams,
  role: 'text' | 'code',
  hasExistingCodeProvider = false,
): EmbeddingProvider | undefined {
  if (role === 'code' && !hasExistingCodeProvider && !override.codeModel && !override.model) {
    return undefined
  }
  const config: ResolvedConfig = { ...resolveConfigFromEnv(), model: override.model, textModel: override.textModel, codeModel: override.codeModel }
  return role === 'text' ? getTextProvider(config) : getCodeProvider(config)
}
