import type { Embedding } from '../models/types.js'
import type { EmbeddingProvider } from './provider.js'

export interface HttpProviderOptions {
  baseUrl: string
  model: string
  apiKey?: string
}

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[] }>
}

/**
 * Generic HTTP embedding provider for any OpenAI-compatible embeddings endpoint.
 * Works with self-hosted alternatives (LM Studio, vLLM, etc.).
 */
export class HttpProvider implements EmbeddingProvider {
  readonly model: string
  private readonly baseUrl: string
  private readonly apiKey: string | undefined
  private _dimensions: number = 0

  constructor(options: HttpProviderOptions) {
    this.model = options.model
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiKey = options.apiKey
  }

  get dimensions(): number {
    return this._dimensions
  }

  async embed(text: string): Promise<Embedding> {
    const [embedding] = await this._request([text])
    return embedding
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    return this._request(texts)
  }

  private async _request(inputs: string[]): Promise<Embedding[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: inputs }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HTTP embed failed (${res.status}): ${body}`)
    }

    const data = (await res.json()) as OpenAIEmbedResponse
    const embeddings = data.data.map((d) => d.embedding)

    if (this._dimensions === 0 && embeddings.length > 0) {
      this._dimensions = embeddings[0].length
    }

    return embeddings
  }
}
