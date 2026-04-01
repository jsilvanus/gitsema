import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { renderFirstSeenResults } from '../../core/search/ranking.js'
import { remoteFirstSeen } from '../../client/remoteClient.js'

export interface FirstSeenCommandOptions {
  top?: string
  remote?: string
}

export async function firstSeenCommand(query: string, options: FirstSeenCommandOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query string is required')
    process.exit(1)
  }

  const remoteUrl = options.remote ?? process.env.GITSEMA_REMOTE
  if (remoteUrl) {
    process.env.GITSEMA_REMOTE = remoteUrl
    const top = options.top !== undefined ? parseInt(options.top, 10) : 10
    try {
      const results = await remoteFirstSeen(query, top)
      console.log(renderFirstSeenResults(results))
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
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

  // Get top-k results by semantic similarity; vectorSearch populates firstSeen/firstCommit.
  // renderFirstSeenResults re-sorts by earliest date so the output shows when each
  // concept first appeared in the codebase.
  const results = vectorSearch(queryEmbedding, { topK })
  console.log(renderFirstSeenResults(results))
}
