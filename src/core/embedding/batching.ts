/**
 * BatchingProvider — Phase 62: Heavy Batching for Ollama + HTTP providers.
 *
 * Wraps any EmbeddingProvider and adds:
 *   - Sub-batch chunking: splits large `embedBatch()` calls into smaller
 *     chunks so backends are never overwhelmed by huge arrays.
 *   - Per-sub-batch retry: transient network errors are retried with
 *     exponential back-off before propagating.
 *   - Automatic fallback to per-item `embed()` when a sub-batch fails all
 *     retries (best-effort: failed items return a zero vector and increment
 *     the error count).
 *
 * Usage:
 *   const provider = new BatchingProvider(new OllamaProvider(), { maxSubBatchSize: 32 })
 *   const embeddings = await provider.embedBatch(texts)  // safely chunked + retried
 */

import type { Embedding } from '../models/types.js'
import type { EmbeddingProvider } from './provider.js'

export interface BatchingOptions {
  /**
   * Maximum number of texts to send in a single underlying `embedBatch()` call.
   * Larger values improve throughput; smaller values reduce backend load per request.
   * Default: 32.
   */
  maxSubBatchSize?: number
  /**
   * Number of times to retry a failed sub-batch before falling back to per-item embedding.
   * Default: 2.
   */
  retries?: number
  /**
   * Base delay between retries in milliseconds.  Each retry doubles the delay (exponential back-off).
   * Default: 300.
   */
  retryDelayMs?: number
}

const DEFAULT_MAX_SUB_BATCH = 32
const DEFAULT_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wraps any EmbeddingProvider to add transparent sub-batch chunking and
 * per-batch retry logic.  All single-item `embed()` calls pass through
 * unchanged.
 */
export class BatchingProvider implements EmbeddingProvider {
  readonly model: string
  private readonly inner: EmbeddingProvider
  private readonly maxSubBatchSize: number
  private readonly retries: number
  private readonly retryDelayMs: number

  constructor(inner: EmbeddingProvider, options: BatchingOptions = {}) {
    this.inner = inner
    this.model = inner.model
    this.maxSubBatchSize = options.maxSubBatchSize ?? DEFAULT_MAX_SUB_BATCH
    this.retries = options.retries ?? DEFAULT_RETRIES
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  }

  get dimensions(): number {
    return this.inner.dimensions
  }

  /** Pass-through single-embed to the wrapped provider. */
  embed(text: string): Promise<Embedding> {
    return this.inner.embed(text)
  }

  /**
   * Embeds `texts` in sub-batches of at most `maxSubBatchSize`, retrying
   * each sub-batch up to `retries` times on failure.  When a sub-batch fails
   * all retries, falls back to per-item embedding; items that still fail are
   * replaced with zero vectors.
   */
  async embedBatch(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) return []

    const results: Embedding[] = new Array(texts.length)

    for (let start = 0; start < texts.length; start += this.maxSubBatchSize) {
      const end = Math.min(start + this.maxSubBatchSize, texts.length)
      const subTexts = texts.slice(start, end)
      const subEmbeddings = await this._embedSubBatchWithRetry(subTexts)
      for (let i = 0; i < subEmbeddings.length; i++) {
        results[start + i] = subEmbeddings[i]
      }
    }

    return results
  }

  /**
   * Attempts to embed a sub-batch.  Retries with exponential back-off on
   * failure; falls back to per-item embedding if all retries are exhausted.
   */
  private async _embedSubBatchWithRetry(texts: string[]): Promise<Embedding[]> {
    let lastError: unknown
    let delay = this.retryDelayMs

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        if (typeof this.inner.embedBatch === 'function') {
          return await this.inner.embedBatch(texts)
        }
        // Provider doesn't support batching — embed individually
        return await Promise.all(texts.map((t) => this.inner.embed(t)))
      } catch (err) {
        lastError = err
        if (attempt < this.retries) {
          await sleep(delay)
          delay *= 2
        }
      }
    }

    // All retries exhausted — fall back to per-item embedding
    return Promise.all(
      texts.map(async (t) => {
        try {
          return await this.inner.embed(t)
        } catch {
          // Return a zero vector matching the provider's dimension so the
          // indexer can continue.  The calling code treats this as an embed
          // failure and increments its error counter.
          const dims = this.inner.dimensions || 1
          return new Array<number>(dims).fill(0)
        }
      }),
    )
  }
}
