import type { Embedding } from '../models/types.js'
import type { EmbeddingProvider } from './provider.js'

export interface OllamaOptions {
  baseUrl?: string
  model?: string
}

interface OllamaEmbedResponse {
  embedding: number[]
}

/** Response from the modern `/api/embed` batch endpoint (Ollama ≥ 0.1.34). */
interface OllamaEmbedBatchResponse {
  embeddings: number[][]
}

/**
 * Ollama embedding provider — calls http://localhost:11434.
 *
 * Single-embed uses the legacy `/api/embeddings` endpoint.
 * Batch-embed uses the newer `/api/embed` endpoint (Ollama ≥ 0.1.34) which
 * natively accepts `input: string[]`, eliminating N round-trips for a batch.
 * Falls back to concurrent per-item `/api/embeddings` calls when the newer
 * endpoint is unavailable (404) — the first 404 is remembered so no further
 * probing occurs for the life of the provider instance.
 *
 * Dimensions are discovered lazily on the first embed call.
 */
export class OllamaProvider implements EmbeddingProvider {
  readonly model: string
  private readonly baseUrl: string
  private _dimensions: number = 0
  /** True once we know /api/embed is not supported on this Ollama instance. */
  private _batchEndpointUnavailable = false

  constructor(options: OllamaOptions = {}) {
    this.model = options.model ?? 'nomic-embed-text'
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434'
  }

  get dimensions(): number {
    return this._dimensions
  }

  async embed(text: string): Promise<Embedding> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Ollama embed failed (${res.status}): ${body}`)
    }

    const data = (await res.json()) as OllamaEmbedResponse
    const embedding = data.embedding

    if (this._dimensions === 0) {
      this._dimensions = embedding.length
    }

    return embedding
  }

  /**
   * Embeds multiple texts in a single HTTP request using Ollama's `/api/embed`
   * endpoint (available since Ollama 0.1.34).  If the server responds with a
   * 404 (older Ollama), falls back to concurrent per-item `/api/embeddings`
   * calls and remembers the unavailability so future calls skip the probe.
   */
  async embedBatch(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) return []

    if (!this._batchEndpointUnavailable) {
      try {
        const res = await fetch(`${this.baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, input: texts }),
        })

        if (res.status === 404) {
          // Endpoint not available on this Ollama version — remember and fall through
          this._batchEndpointUnavailable = true
        } else if (!res.ok) {
          const body = await res.text()
          throw new Error(`Ollama batch embed failed (${res.status}): ${body}`)
        } else {
          const data = (await res.json()) as OllamaEmbedBatchResponse
          if (this._dimensions === 0 && data.embeddings.length > 0) {
            this._dimensions = data.embeddings[0].length
          }
          return data.embeddings
        }
      } catch (err) {
        // Re-throw non-fetch errors (e.g. connection refused); only swallow 404
        if (!(err instanceof Error && err.message.includes('Ollama batch embed failed'))) {
          // Check if this is a 404 we already handled above
          if (!this._batchEndpointUnavailable) throw err
        } else {
          throw err
        }
      }
    }

    // Fallback: per-item embeds in parallel (same as before)
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}
