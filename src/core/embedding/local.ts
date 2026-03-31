import type { Embedding } from '../models/types.js'
import type { EmbeddingProvider } from './provider.js'

export interface OllamaOptions {
  baseUrl?: string
  model?: string
}

interface OllamaEmbedResponse {
  embedding: number[]
}

/**
 * Ollama embedding provider — calls http://localhost:11434/api/embeddings.
 * Dimensions are discovered lazily on first embed call.
 */
export class OllamaProvider implements EmbeddingProvider {
  readonly model: string
  private readonly baseUrl: string
  private _dimensions: number = 0

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

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}
