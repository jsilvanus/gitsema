import type { Embedding } from '../models/types.js'
import type { EmbeddingProvider } from './provider.js'

export interface EmbedeerOptions {
  model?: string
}

function isNumberArray(x: any): x is number[] {
  return Array.isArray(x) && x.length > 0 && typeof x[0] === 'number'
}

function isNumberMatrix(x: any): x is number[][] {
  return Array.isArray(x) && x.length > 0 && Array.isArray(x[0]) && typeof x[0][0] === 'number'
}

/**
 * Lightweight wrapper for the `@jsilvanus/embedeer` npm package.

 * The package surface for `@jsilvanus/embedeer` may vary between releases. This provider
 * attempts a few common call patterns (function export, `embed` / `embedBatch`)
 * and normalises the responses into the project's `Embedding` shape.
 *
 * If the `@jsilvanus/embedeer` package is not installed the provider throws with an
 * actionable message so the user can `npm install @jsilvanus/embedeer` in their project.
 */
export class EmbedeerProvider implements EmbeddingProvider {
  readonly model: string
  private _client: any = null
  private _dimensions: number = 0
  private _initPromise: Promise<void> | null = null

  constructor(options: EmbedeerOptions = {}) {
    this.model = options.model ?? 'embedeer'
  }

  get dimensions(): number {
    return this._dimensions
  }

  private async initClient(): Promise<void> {
    if (this._initPromise) return this._initPromise
    this._initPromise = (async () => {
      // Import only the scoped package — do not fall back to an unscoped package.
      try {
        const mod = await import('@jsilvanus/embedeer')
        // Prefer default export, fallback to module namespace
        this._client = (mod && (mod.default ?? mod))
      } catch (err) {
        throw new Error(
          "Embedeer provider requires the '@jsilvanus/embedeer' package. Install it with: npm install @jsilvanus/embedeer",
        )
      }
    })()
    return this._initPromise
  }

  private extractSingle(res: any): number[] {
    if (!res) throw new Error('Empty response from embedeer')
    if (isNumberArray(res)) return res
    if (isNumberMatrix(res)) return res[0]
    if (Array.isArray(res) && res.length > 0) {
      // e.g. [{ embedding: [...] }, ...]
      const first = res[0]
      if (first && Array.isArray(first.embedding)) return first.embedding
      if (first && Array.isArray(first.embeddings)) return first.embeddings[0]
    }
    if (res.embedding && isNumberArray(res.embedding)) return res.embedding
    if (res.embeddings && isNumberMatrix(res.embeddings)) return res.embeddings[0]
    if (res.data && Array.isArray(res.data) && res.data[0] && isNumberArray(res.data[0].embedding)) {
      return res.data[0].embedding
    }
    throw new Error('Unrecognised response format from embedeer')
  }

  private extractBatch(res: any): number[][] {
    if (!res) throw new Error('Empty batch response from embedeer')
    if (isNumberMatrix(res)) return res
    if (isNumberArray(res)) return [res]
    if (res.embeddings && isNumberMatrix(res.embeddings)) return res.embeddings
    if (res.data && Array.isArray(res.data)) {
      return res.data.map((d: any) => d.embedding ?? d)
    }
    if (Array.isArray(res) && res.length > 0) {
      // e.g. [ [..], [..] ] or [{embedding: [...]}, ...]
      if (isNumberMatrix(res)) return res
      if (res[0] && res[0].embedding) return res.map((r: any) => r.embedding)
    }
    throw new Error('Unrecognised batch response format from embedeer')
  }

  async embed(text: string): Promise<Embedding> {
    await this.initClient()
    const client = this._client
    let res: any

    if (typeof client === 'function') {
      // Many embedding libraries export a single function that accepts a string
      res = await client(text, { model: this.model })
    } else if (client && typeof client.embed === 'function') {
      res = await client.embed(text, { model: this.model })
    } else if (client && typeof client.embedBatch === 'function') {
      const batch = await client.embedBatch([text], { model: this.model })
      res = batch
    } else {
      throw new Error('Embedeer client does not expose a known embed method')
    }

    const embedding = this.extractSingle(res)
    if (this._dimensions === 0 && embedding.length > 0) this._dimensions = embedding.length
    return embedding
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    await this.initClient()
    const client = this._client
    if (texts.length === 0) return []

    try {
      if (typeof client === 'function') {
        const res = await client(texts, { model: this.model })
        const embeddings = this.extractBatch(res)
        if (this._dimensions === 0 && embeddings.length > 0) this._dimensions = embeddings[0].length
        return embeddings
      }

      if (client && typeof client.embedBatch === 'function') {
        const res = await client.embedBatch(texts, { model: this.model })
        const embeddings = this.extractBatch(res)
        if (this._dimensions === 0 && embeddings.length > 0) this._dimensions = embeddings[0].length
        return embeddings
      }

      if (client && typeof client.embed === 'function') {
        const results = await Promise.all(texts.map((t) => client.embed(t, { model: this.model })))
        const embeddings = results.map((r: any) => (isNumberArray(r) ? r : r.embedding ?? r.embeddings?.[0]))
        if (this._dimensions === 0 && embeddings.length > 0) this._dimensions = embeddings[0].length
        return embeddings
      }
    } catch (err) {
      // Fall through to per-item fallback below on unexpected formats/errors
    }

    // Fallback to per-item embedding using the single-item path
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}

/**
 * Ensure the named model is available to the `@jsilvanus/embedeer` runtime and run any
 * provider-side optimisation step (quantize/compile) if supported.
 *
 * This attempts a few common @jsilvanus/embedeer package APIs so it works across
 * different releases. It is intentionally forgiving: if the package exposes a
 * recognised download/optimise function it will be invoked; if not the function
 * throws with guidance the user can follow to install or manage the model manually.
 */
export async function ensureModelDownloadedAndOptimized(
  modelName: string,
  opts: { downloadIfMissing?: boolean; optimize?: boolean } = {},
): Promise<void> {
  const downloadIfMissing = opts.downloadIfMissing ?? true
  const optimize = opts.optimize ?? true
  // Import the scoped package only.
  let mod: any = null
  try {
    // eslint-disable-next-line no-await-in-loop
    mod = await import('@jsilvanus/embedeer')
  } catch (err) {
    throw new Error("Embedeer provider requires the '@jsilvanus/embedeer' package. Install it with: npm install @jsilvanus/embedeer")
  }
  const client: any = (mod && (mod.default ?? mod))

  const callAny = async (names: string[], args: any[] = []): Promise<boolean> => {
    for (const n of names) {
      try {
        if (typeof client[n] === 'function') {
          // eslint-disable-next-line no-await-in-loop
          await client[n](...args)
          return true
        }
      } catch (err) {
        // If a function exists but errors, propagate the error upwards
        throw err
      }
    }
    return false
  }

  // --- Check presence ---
  let present = false
  try {
    if (typeof client.hasModel === 'function') {
      present = await client.hasModel(modelName)
    } else if (typeof client.isModelDownloaded === 'function') {
      present = await client.isModelDownloaded(modelName)
    } else if (typeof client.listModels === 'function') {
      const list = await client.listModels()
      if (Array.isArray(list)) {
        present = list.includes(modelName) || list.some((m: any) => m && (m.name === modelName || m.id === modelName))
      }
    }
  } catch (err) {
    // Non-fatal — we'll attempt download below if requested
    present = false
  }

  // --- Download if missing ---
  if (!present && downloadIfMissing) {
    // Prefer the explicit `loadModel` API (common in @jsilvanus/embedeer),
    // then fall back to a number of other common names.
    if (typeof client.loadModel === 'function') {
      // `loadModel` typically downloads and initialises the model if missing.
      // eslint-disable-next-line no-await-in-loop
      await client.loadModel(modelName)
    } else {
      const downloadFns = ['downloadModel', 'pullModel', 'download', 'pull', 'installModel', 'ensureModel', 'fetchModel', 'fetch', 'install']
      const ok = await callAny(downloadFns, [modelName])
      if (!ok) {
        // try object-style API: download({ model })
        if (typeof client.download === 'function') {
          try {
            // eslint-disable-next-line no-await-in-loop
            await client.download({ model: modelName })
          } catch (err) {
            throw new Error(`Failed to download model '${modelName}' via embedeer.download({model}). Error: ${err instanceof Error ? err.message : String(err)}`)
          }
        } else {
          throw new Error(`embedeer package found but no recognised download API. Please download model '${modelName}' manually or upgrade @jsilvanus/embedeer.`)
        }
      }
    }
  }

  // --- Optimise ---
  if (optimize) {
    const optimizeFns = ['optimizeModel', 'optimize', 'quantize', 'compileModel', 'prepareModel', 'build', 'convertModel', 'prepare', 'applyPerfProfile']
    // Try top-level APIs first
    const ok = await callAny(optimizeFns, [modelName])
    if (!ok) {
      // Some APIs accept no args and optimise all available models
      const okNoArgs = await callAny(optimizeFns, [])
      if (!okNoArgs) {
        // Try nested `Embedder`-style APIs (some releases expose methods under an `Embedder` namespace)
        const embedderTarget = client && (client.Embedder ?? client.embedder ?? client.default?.Embedder)
        if (embedderTarget && typeof embedderTarget === 'object') {
          const callAnyOnTarget = async (names: string[], args: any[] = []) => {
            for (const n of names) {
              try {
                if (typeof embedderTarget[n] === 'function') {
                  // eslint-disable-next-line no-await-in-loop
                  await embedderTarget[n](...args)
                  return true
                }
              } catch (err) {
                throw err
              }
            }
            return false
          }

          const okNested = await callAnyOnTarget(optimizeFns, [modelName])
          if (!okNested) {
            const okNestedNoArgs = await callAnyOnTarget(optimizeFns, [])
            if (!okNestedNoArgs) {
              console.log(`embedeer: optimisation API not found for model '${modelName}'; skipping optimise step.`)
            }
          }
        } else {
          // Not fatal — optimisation is a best-effort convenience.
          console.log(`embedeer: optimisation API not found for model '${modelName}'; skipping optimise step.`)
        }
      }
    }
  }
}
