/**
 * Narrator audit logging.
 *
 * Every narration call should be accompanied by a structured audit log entry
 * so that operators can trace when, why, and to what model content was sent.
 *
 * IMPORTANT: Audit entries must NOT contain the raw prompt or response text.
 * They record only metadata: timing, model, operation, redacted-field names.
 */

import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Audit entry type
// ---------------------------------------------------------------------------

export interface NarratorAuditEntry {
  timestamp: number
  operation: 'narrate' | 'explain'
  service: string
  modelHint: string
  durationMs: number
  tokensUsed: number
  redactedFields: string[]
  success: boolean
  errorMessage?: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a narrator audit event to the structured logger.
 * The entry is logged at `info` level under the `llm_audit` key so it can
 * be filtered by operators without exposing user data.
 */
export function recordAudit(entry: NarratorAuditEntry): void {
  logger.info(`[llm_audit] op=${entry.operation} service=${entry.service} model=${entry.modelHint} durationMs=${entry.durationMs} success=${entry.success} redacted=${entry.redactedFields.join(',') || 'none'}${entry.errorMessage ? ` error=${entry.errorMessage}` : ''}`)
}

/**
 * Helper: run `fn` and automatically record a timing audit entry.
 *
 * @param operation - 'narrate' | 'explain'
 * @param service   - provider name string (e.g. 'chattydeer')
 * @param modelHint - model name / hint
 * @param redactedFields - list of redaction patterns that fired
 * @param fn        - async function to wrap
 */
export async function withAudit<T>(
  operation: 'narrate' | 'explain',
  service: string,
  modelHint: string,
  redactedFields: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    recordAudit({
      timestamp: Date.now(),
      operation,
      service,
      modelHint,
      durationMs: Date.now() - start,
      tokensUsed: 0,
      redactedFields,
      success: true,
    })
    return result
  } catch (err) {
    recordAudit({
      timestamp: Date.now(),
      operation,
      service,
      modelHint,
      durationMs: Date.now() - start,
      tokensUsed: 0,
      redactedFields,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
