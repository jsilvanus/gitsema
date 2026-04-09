/**
 * Core types for the narrator/explainer subsystem.
 *
 * NarratorProvider is the interface that all LLM backends must implement.
 * The canonical implementation backed by @jsilvanus/chattydeer lives in
 * chattydeerProvider.ts.
 */

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface NarrateRequest {
  /** System prompt / instruction for the LLM. */
  systemPrompt: string
  /** User-facing prompt text (already redacted before reaching the provider). */
  userPrompt: string
  /** Soft cap on output tokens (provider may ignore if unsupported). */
  maxTokens?: number
}

export interface NarrateResponse {
  /** Generated narrative text. */
  prose: string
  /** Approximate tokens consumed (0 when unavailable). */
  tokensUsed: number
  /** Redacted field pattern names that were removed from the payload. */
  redactedFields: string[]
  /** True when narration was actually attempted; false in safe-by-default mode. */
  llmEnabled: boolean
}

/**
 * LLM backend that can generate human-readable narrative text.
 * Implementations must be safe-by-default (refuse to make network calls
 * unless explicitly enabled).
 */
export interface NarratorProvider {
  readonly modelName: string
  narrate(req: NarrateRequest): Promise<NarrateResponse>
  destroy(): Promise<void>
}

// ---------------------------------------------------------------------------
// Narrator model config (stored in embed_config with kind='narrator')
// ---------------------------------------------------------------------------

export interface NarratorModelParams {
  /** OpenAI-compatible base URL for the LLM endpoint. Required. */
  httpUrl: string
  /** Bearer token / API key. Optional. */
  apiKey?: string
  /** Max tokens per narration call (default 512). */
  maxTokens?: number
  /** Temperature (0 = deterministic, default 0.3). */
  temperature?: number
}

export interface NarratorModelConfig {
  /** embed_config.id in the DB. */
  id: number
  /** Human-readable name / local alias (stored as embed_config.model). */
  name: string
  /** Provider family (e.g. 'chattydeer', 'http'). */
  provider: string
  /** Decoded NarratorModelParams from embed_config.params_json. */
  params: NarratorModelParams
  createdAt: number
  lastUsedAt?: number
}

// ---------------------------------------------------------------------------
// CLI / route payloads
// ---------------------------------------------------------------------------

export type NarrateFocus = 'bugs' | 'features' | 'ops' | 'security' | 'deps' | 'performance' | 'all'
export type NarrateFormat = 'md' | 'text' | 'json'

export interface NarrateCommandOptions {
  since?: string
  until?: string
  range?: string
  focus?: NarrateFocus
  format?: NarrateFormat
  maxCommits?: number
  narratorModelId?: number
  /** Raw CLI model override (name, looked up in embed_config by name). */
  model?: string
  /**
   * When true (the default), skip the LLM call and return the raw commit
   * evidence so the caller (or an MCP agent) can narrate/filter itself.
   * Set to false (or pass --narrate on CLI) to call the configured LLM.
   */
  evidenceOnly?: boolean
}

export interface ExplainCommandOptions {
  since?: string
  until?: string
  log?: string
  files?: string
  format?: NarrateFormat
  narratorModelId?: number
  model?: string
  /** Same semantics as in NarrateCommandOptions. Default true. */
  evidenceOnly?: boolean
}

// ---------------------------------------------------------------------------
// Commit event (lightweight, extracted from git log)
// ---------------------------------------------------------------------------

export interface CommitEvent {
  hash: string
  date: string
  authorName: string
  subject: string
  body: string
  /** Heuristic tags assigned during classification */
  tags: string[]
}

// ---------------------------------------------------------------------------
// Narration output
// ---------------------------------------------------------------------------

export interface NarrationResult {
  prose: string
  commitCount: number
  citations: string[]
  redactedFields: string[]
  llmEnabled: boolean
  format: NarrateFormat
  /**
   * Raw evidence (commit events) returned when evidenceOnly=true.
   * Undefined when LLM narration was performed.
   */
  evidence?: CommitEvent[]
}
