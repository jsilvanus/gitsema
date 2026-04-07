/**
 * Adaptive tuning helpers for the gitsema indexer (Phase 63).
 *
 * Provides:
 *   - Profile presets (`speed` / `balanced` / `quality`) that set coherent
 *     concurrency and batch-size defaults.
 *   - Auto-batch detection: when the caller has not explicitly set an
 *     `embedBatchSize`, this module checks whether the provider supports
 *     `embedBatch()` and picks a sensible default.
 *   - `AdaptiveBatchController`: adjusts the live batch size up or down
 *     during an indexing run based on observed embedding latency and error
 *     rates, keeping throughput near-optimal without overloading the backend.
 *   - `postRunRecommendations()`: examines the final IndexStats and prints
 *     actionable maintenance suggestions to the console (e.g. build VSS index,
 *     run backfill-fts, vacuum the DB).
 */

import type { EmbeddingProvider } from '../embedding/provider.js'

// ---------------------------------------------------------------------------
// Profile presets
// ---------------------------------------------------------------------------

/** Profile names accepted by `--profile`. */
export type IndexProfile = 'speed' | 'balanced' | 'quality'

export interface ProfileDefaults {
  concurrency: number
  /** Suggested embed batch size (applies only when provider supports embedBatch). */
  embedBatchSize: number
  chunker: 'file' | 'function' | 'fixed'
}

const PROFILES: Record<IndexProfile, ProfileDefaults> = {
  speed: {
    concurrency: 8,
    embedBatchSize: 32,
    chunker: 'file',
  },
  balanced: {
    concurrency: 4,
    embedBatchSize: 16,
    chunker: 'file',
  },
  quality: {
    concurrency: 2,
    embedBatchSize: 4,
    chunker: 'function',
  },
}

/**
 * Returns profile defaults for the given profile name.
 * Throws a descriptive error for unknown names.
 */
export function getProfileDefaults(profile: string): ProfileDefaults {
  if (!(profile in PROFILES)) {
    throw new Error(`Unknown --profile "${profile}". Valid values: speed, balanced, quality.`)
  }
  return PROFILES[profile as IndexProfile]
}

// ---------------------------------------------------------------------------
// Auto-batch detection
// ---------------------------------------------------------------------------

/**
 * Determines the effective embed batch size to use for a run.
 *
 * Resolution order:
 *   1. Explicit user value (returned unchanged).
 *   2. Auto-detect: when the provider exposes `embedBatch()`, return the
 *      profile default (or 16 when no profile was requested).
 *   3. Fallback: 1 (no batching — original behaviour).
 */
export function resolveEmbedBatchSize(opts: {
  userValue: number | undefined
  provider: EmbeddingProvider
  profileBatchSize?: number
}): number {
  const { userValue, provider, profileBatchSize } = opts
  if (userValue !== undefined) return userValue
  if (typeof provider.embedBatch === 'function') {
    return profileBatchSize ?? 16
  }
  return 1
}

// ---------------------------------------------------------------------------
// Adaptive batch controller
// ---------------------------------------------------------------------------

/**
 * A simple adaptive controller that adjusts `embedBatchSize` in-flight based
 * on observed embedding latency per item and consecutive error counts.
 *
 * The controller is deliberately conservative: it only widens the batch when
 * latency has been stable and low for several consecutive windows, and it
 * immediately halves the batch on consecutive errors.
 *
 * Usage:
 *   ```ts
 *   const ctrl = new AdaptiveBatchController({ initialBatchSize: 16 })
 *   // after each batch:
 *   ctrl.observe({ latencyPerItemMs: 12, hadError: false })
 *   const nextSize = ctrl.batchSize
 *   ```
 */
export class AdaptiveBatchController {
  private _batchSize: number
  private readonly minBatchSize: number
  private readonly maxBatchSize: number
  /** ms per item below which we consider widening the batch */
  private readonly targetLatencyMs: number
  private consecutiveGoodWindows = 0
  private consecutiveErrors = 0

  constructor(opts: {
    initialBatchSize: number
    minBatchSize?: number
    maxBatchSize?: number
    targetLatencyMs?: number
  }) {
    this._batchSize = opts.initialBatchSize
    this.minBatchSize = opts.minBatchSize ?? 1
    this.maxBatchSize = opts.maxBatchSize ?? 128
    this.targetLatencyMs = opts.targetLatencyMs ?? 50
  }

  get batchSize(): number {
    return this._batchSize
  }

  /**
   * Record the result of the last batch and compute the next batch size.
   *
   * @param latencyPerItemMs  Wall-clock ms / number-of-items for the last batch.
   * @param hadError          True when the batch encountered an embedding error.
   */
  observe(opts: { latencyPerItemMs: number; hadError: boolean }): void {
    if (opts.hadError) {
      this.consecutiveErrors++
      this.consecutiveGoodWindows = 0
      if (this.consecutiveErrors >= 2) {
        // Halve batch size on repeated errors
        this._batchSize = Math.max(this.minBatchSize, Math.floor(this._batchSize / 2))
      }
      return
    }

    this.consecutiveErrors = 0

    if (opts.latencyPerItemMs <= this.targetLatencyMs) {
      this.consecutiveGoodWindows++
      // Widen batch after 3 consecutive good windows
      if (this.consecutiveGoodWindows >= 3) {
        this._batchSize = Math.min(this.maxBatchSize, Math.ceil(this._batchSize * 1.5))
        this.consecutiveGoodWindows = 0
      }
    } else {
      // Latency too high — shrink slightly
      this.consecutiveGoodWindows = 0
      this._batchSize = Math.max(this.minBatchSize, Math.floor(this._batchSize * 0.75))
    }
  }
}

// ---------------------------------------------------------------------------
// Post-run maintenance recommendations
// ---------------------------------------------------------------------------

export interface PostRunContext {
  /** Total blobs that were newly embedded in this run. */
  indexed: number
  /** Total blobs already in the database (seen - indexed - failed). */
  existingBlobCount: number
  /** True when the user has never run `gitsema backfill-fts`. */
  hasFtsGap?: boolean
}

/**
 * Examines the post-run context and returns human-readable recommendation
 * strings. Returns an empty array when no actions are needed.
 */
export function postRunRecommendations(ctx: PostRunContext): string[] {
  const recommendations: string[] = []
  const totalBlobs = ctx.existingBlobCount + ctx.indexed

  if (totalBlobs >= 10_000) {
    recommendations.push(
      `ℹ  ${totalBlobs.toLocaleString()} blobs indexed — run \`gitsema build-vss\` for HNSW-accelerated search.`,
    )
  }

  if (ctx.hasFtsGap) {
    recommendations.push(
      `ℹ  Some blobs may be missing FTS5 content — run \`gitsema backfill-fts\` to enable --hybrid search on all blobs.`,
    )
  }

  if (totalBlobs >= 50_000) {
    recommendations.push(
      `ℹ  Large index (${totalBlobs.toLocaleString()} blobs) — run \`gitsema vacuum\` periodically to reclaim disk space.`,
    )
  }

  return recommendations
}
