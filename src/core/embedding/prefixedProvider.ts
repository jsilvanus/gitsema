import type { EmbeddingProvider } from './provider.js'
import type { Embedding } from '../models/types.js'

/**
 * Wraps an `EmbeddingProvider` and prepends a fixed prefix string (followed by
 * a single space) to every input text before forwarding to the inner provider.
 *
 * This enables instruction-following models (e.g. nomic-embed-text-v1) to
 * receive the task instruction they require, e.g.:
 *   "search_document: <file content>"
 *   "search_query: <user query>"
 *
 * The `model` and `dimensions` properties are forwarded from the inner provider
 * so the rest of the system (cache keys, DB provenance) remains unchanged.
 */
export class PrefixedProvider implements EmbeddingProvider {
  readonly model: string

  get dimensions(): number {
    return this.inner.dimensions
  }

  constructor(
    readonly inner: EmbeddingProvider,
    readonly prefix: string,
  ) {
    this.model = inner.model
  }

  async embed(text: string): Promise<Embedding> {
    return this.inner.embed(`${this.prefix} ${text}`)
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    const prefixed = texts.map((t) => `${this.prefix} ${t}`)
    if (this.inner.embedBatch) {
      return this.inner.embedBatch(prefixed)
    }
    return Promise.all(prefixed.map((t) => this.inner.embed(t)))
  }
}
