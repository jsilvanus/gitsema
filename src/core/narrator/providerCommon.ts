/**
 * Shared helpers for NarratorProvider implementations (review9 §6).
 *
 * Both ChattydeerNarratorProvider and CliNarratorProvider open `narrate()` the
 * same way — redact the user+system prompts, then short-circuit with a
 * placeholder when disabled — differing only in the setup hint they show. These
 * helpers hold that common prologue so the redaction discipline stays in one
 * place.
 */

import type { NarrateRequest, NarrateResponse } from './types.js'
import { redact } from './redact.js'

export interface RedactedPrompts {
  redactedUser: string
  redactedSystem: string
  /** Pattern names that fired on the user prompt (the system prompt is persona text). */
  firedPatterns: string[]
}

/** Redact both prompts before any logging, network, or subprocess use. */
export function redactPrompts(req: NarrateRequest): RedactedPrompts {
  const { text: redactedUser, firedPatterns } = redact(req.userPrompt)
  const { text: redactedSystem } = redact(req.systemPrompt)
  return { redactedUser, redactedSystem, firedPatterns }
}

/**
 * Safe-by-default placeholder returned when no narrator model is configured.
 * `setupHint` is the provider-specific `gitsema models add …` recipe.
 */
export function disabledNarratorResponse(redactedFields: string[], setupHint: string): NarrateResponse {
  return {
    prose: `[LLM narrator disabled — ${setupHint}]`,
    tokensUsed: 0,
    redactedFields,
    llmEnabled: false,
  }
}
