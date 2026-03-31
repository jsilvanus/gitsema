import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { vectorSearch, mergeSearchResults } from '../../core/search/vectorSearch.js'
import { renderResults } from '../../core/search/ranking.js'

export interface SearchCommandOptions {
  top?: string
}

function buildProvider(providerType: string, model: string): EmbeddingProvider {
  if (providerType === 'http') {
    const baseUrl = process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      console.error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
      process.exit(1)
    }
    return new HttpProvider({ baseUrl, model, apiKey: process.env.GITSEMA_API_KEY })
  }
  return new OllamaProvider({ model })
}

async function embedQuery(provider: EmbeddingProvider, model: string, query: string): Promise<number[]> {
  try {
    return await provider.embed(query)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query with ${model} — ${msg}`)
    process.exit(1)
  }
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
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel
  const dualModel = codeModel !== textModel

  const textProvider = buildProvider(providerType, textModel)
  const codeProvider = dualModel ? buildProvider(providerType, codeModel) : null

  // Embed the query with the text model (natural-language prose)
  const textEmbedding = await embedQuery(textProvider, textModel, query)

  if (dualModel && codeProvider) {
    // Dual-model search: embed with both models and merge results
    const codeEmbedding = await embedQuery(codeProvider, codeModel, query)
    const textResults = vectorSearch(textEmbedding, { topK, model: textModel })
    const codeResults = vectorSearch(codeEmbedding, { topK, model: codeModel })
    const results = mergeSearchResults(textResults, codeResults, topK)
    console.log(renderResults(results))
  } else {
    // Single-model search (backward-compatible)
    const results = vectorSearch(textEmbedding, { topK })
    console.log(renderResults(results))
  }
}
