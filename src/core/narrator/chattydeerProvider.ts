/**
 * ChattydeerNarratorProvider — NarratorProvider backed by @jsilvanus/chattydeer.
 *
 * This adapter:
 *   1. Guards against remote calls unless explicitly enabled via the model config.
 *   2. Applies redaction to all payloads before sending to the LLM.
 *   3. Uses the Explainer class from chattydeer for structured output.
 *   4. Falls back gracefully when the LLM is unavailable.
 *
 * Safe-by-default: when `enabled` is false (default when no model config is set),
 * `narrate()` returns immediately with a placeholder — no network call is made.
 */

import type { NarratorProvider, NarrateRequest, NarrateResponse, NarratorModelParams } from './types.js'
import { redact } from './redact.js'
import { withAudit } from './audit.js'
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Lazy import of chattydeer to avoid loading HuggingFace transformers at module
// level. The dynamic import runs only when narrate() is actually called.
// ---------------------------------------------------------------------------

let _explainerModule: {
  Explainer: {
    create(modelName: string, opts?: Record<string, unknown>): Promise<{
      explain(req: {
        task: string
        domain: string
        context: Record<string, unknown>
        evidence: Array<{ id: number; source: string; excerpt: string }>
        maxTokens?: number
      }): Promise<{ explanation: string; labels: string[]; references: unknown[]; meta: unknown }>
      destroy(): Promise<void>
    }>
  }
} | null = null

async function getExplainerClass(): Promise<typeof _explainerModule> {
  if (_explainerModule === null) {
    // @ts-ignore — chattydeer is a plain JS ESM package without types
    _explainerModule = await import('@jsilvanus/chattydeer')
  }
  return _explainerModule
}

// ---------------------------------------------------------------------------
// Placeholder returned in safe-by-default (disabled) mode
// ---------------------------------------------------------------------------

function disabledResponse(redactedFields: string[]): NarrateResponse {
  return {
    prose: '[LLM narrator disabled — configure a narrator model via: gitsema models add <name> --kind narrator --http-url <url>]',
    tokensUsed: 0,
    redactedFields,
    llmEnabled: false,
  }
}

// ---------------------------------------------------------------------------
// ChattydeerNarratorProvider
// ---------------------------------------------------------------------------

/**
 * Options for constructing the provider.
 *
 * When `params` is undefined the provider operates in safe-by-default
 * (disabled) mode — no network calls are made.
 */
export interface ChattydeerProviderOptions {
  modelName: string
  /** Narrator model params from the DB-backed config. Undefined → disabled. */
  params?: NarratorModelParams
}

export class ChattydeerNarratorProvider implements NarratorProvider {
  readonly modelName: string
  private readonly _params: NarratorModelParams | undefined
  private readonly _enabled: boolean

  constructor(opts: ChattydeerProviderOptions) {
    this.modelName = opts.modelName
    this._params = opts.params
    // A provider is enabled if params are supplied AND an httpUrl is set.
    this._enabled = !!(opts.params?.httpUrl)
  }

  async narrate(req: NarrateRequest): Promise<NarrateResponse> {
    // Redact before anything else — including logging
    const { text: redactedUser, firedPatterns: userFired } = redact(req.userPrompt)
    const { text: redactedSystem } = redact(req.systemPrompt)
    const allFired = userFired

    if (!this._enabled || !this._params) {
      return disabledResponse(allFired)
    }

    const params = this._params
    const modelName = this.modelName
    const maxTokens = req.maxTokens ?? params.maxTokens ?? 512

    const fn = async (): Promise<NarrateResponse> => {
      const mod = await getExplainerClass()
      if (!mod) {
        throw new Error('chattydeer module failed to load')
      }

      // Build a generateFn that calls the configured HTTP endpoint
      // so we don't load local HuggingFace models at all.
      const generateFn = buildHttpGenerateFn(params)

      const explainer = await mod.Explainer.create(modelName, {
        generateFn,
        deterministic: true,
      })

      try {
        const result = await explainer.explain({
          task: 'narrate',
          domain: 'evolution',
          context: { model: modelName },
          evidence: [
            { id: 1, source: 'git-history', excerpt: redactedUser },
            { id: 2, source: 'instructions', excerpt: redactedSystem },
          ],
          maxTokens,
        })

        const prose = result.explanation === 'INSUFFICIENT_EVIDENCE'
          ? '(narrator: insufficient evidence — no meaningful content to summarise)'
          : result.explanation

        return {
          prose,
          tokensUsed: 0,
          redactedFields: allFired,
          llmEnabled: true,
        }
      } finally {
        await explainer.destroy()
      }
    }

    try {
      return await withAudit('narrate', 'chattydeer', modelName, allFired, fn)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[narrator] chattydeer narrate failed: ${msg}`)
      return {
        prose: `(narrator error: ${msg})`,
        tokensUsed: 0,
        redactedFields: allFired,
        llmEnabled: true,
      }
    }
  }

  async destroy(): Promise<void> {
    // Provider holds no persistent resources — adapter is created per call
  }
}

// ---------------------------------------------------------------------------
// HTTP generate function — calls an OpenAI-compatible chat completions API
// ---------------------------------------------------------------------------

function buildHttpGenerateFn(params: NarratorModelParams) {
  const { httpUrl, apiKey, temperature = 0.3 } = params

  return async (prompt: string, opts: { max_new_tokens?: number } = {}): Promise<{ text: string; raw: null }> => {
    const endpoint = new URL('/v1/chat/completions', httpUrl).toString()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const body = JSON.stringify({
      model: 'default',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: opts.max_new_tokens ?? 512,
      temperature,
    })

    const response = await fetch(endpoint, { method: 'POST', headers, body })
    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`)
    }
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data.choices?.[0]?.message?.content ?? ''
    return { text, raw: null }
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a disabled-mode provider (safe-by-default, no network calls).
 */
export function createDisabledProvider(name = 'narrator'): ChattydeerNarratorProvider {
  return new ChattydeerNarratorProvider({ modelName: name })
}

/**
 * Create a provider from narrator model params.
 */
export function createChattydeerProvider(name: string, params: NarratorModelParams): ChattydeerNarratorProvider {
  return new ChattydeerNarratorProvider({ modelName: name, params })
}
