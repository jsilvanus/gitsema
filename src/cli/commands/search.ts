import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { renderResults } from '../../core/search/ranking.js'

export interface SearchCommandOptions {
  top?: string
}

export async function searchCommand(query: string, options: SearchCommandOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query string is required')
    process.exit(1)
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 10
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

  let provider: EmbeddingProvider
  if (providerType === 'http') {
    const baseUrl = process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      console.error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
      process.exit(1)
    }
    provider = new HttpProvider({ baseUrl, model, apiKey: process.env.GITSEMA_API_KEY })
  } else {
    provider = new OllamaProvider({ model })
  }

  let queryEmbedding: number[]
  try {
    queryEmbedding = await provider.embed(query)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
  }

  const results = vectorSearch(queryEmbedding, { topK })
  console.log(renderResults(results))
}
