import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { vectorSearch, mergeSearchResults } from '../../core/search/vectorSearch.js'
import { renderResults, groupResults, type GroupMode } from '../../core/search/ranking.js'
import { parseDateArg } from '../../core/search/timeSearch.js'

export interface SearchCommandOptions {
  top?: string
  recent?: boolean
  alpha?: string
  before?: string
  after?: string
  weightVector?: string
  weightRecency?: string
  weightPath?: string
  group?: string
  chunks?: boolean
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

  const alpha = options.alpha !== undefined ? parseFloat(options.alpha) : 0.8
  if (isNaN(alpha) || alpha < 0 || alpha > 1) {
    console.error('Error: --alpha must be a number between 0 and 1')
    process.exit(1)
  }

  let before: number | undefined
  let after: number | undefined

  if (options.before) {
    try {
      before = parseDateArg(options.before)
    } catch (err) {
      console.error(`Error: --before ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }
  if (options.after) {
    try {
      after = parseDateArg(options.after)
    } catch (err) {
      console.error(`Error: --after ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  // Parse three-signal ranking weights
  let weightVector: number | undefined
  let weightRecency: number | undefined
  let weightPath: number | undefined

  if (options.weightVector !== undefined) {
    weightVector = parseFloat(options.weightVector)
    if (isNaN(weightVector) || weightVector < 0) {
      console.error('Error: --weight-vector must be a non-negative number')
      process.exit(1)
    }
  }
  if (options.weightRecency !== undefined) {
    weightRecency = parseFloat(options.weightRecency)
    if (isNaN(weightRecency) || weightRecency < 0) {
      console.error('Error: --weight-recency must be a non-negative number')
      process.exit(1)
    }
  }
  if (options.weightPath !== undefined) {
    weightPath = parseFloat(options.weightPath)
    if (isNaN(weightPath) || weightPath < 0) {
      console.error('Error: --weight-path must be a non-negative number')
      process.exit(1)
    }
  }

  // Parse group mode
  let groupMode: GroupMode | undefined
  if (options.group !== undefined) {
    if (options.group !== 'file' && options.group !== 'module' && options.group !== 'commit') {
      console.error('Error: --group must be one of: file, module, commit')
      process.exit(1)
    }
    groupMode = options.group as GroupMode
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel
  const dualModel = codeModel !== textModel

  const textProvider = buildProvider(providerType, textModel)
  const codeProvider = dualModel ? buildProvider(providerType, codeModel) : null

  // Embed the query with the text model (natural-language prose)
  const textEmbedding = await embedQuery(textProvider, textModel, query)

  const searchOpts = {
    topK,
    recent: options.recent ?? false,
    alpha,
    before,
    after,
    weightVector,
    weightRecency,
    weightPath,
    query,
    searchChunks: options.chunks ?? false,
  }

  let results
  if (dualModel && codeProvider) {
    // Dual-model search: embed with both models and merge results
    const codeEmbedding = await embedQuery(codeProvider, codeModel, query)
    const textResults = vectorSearch(textEmbedding, { ...searchOpts, model: textModel })
    const codeResults = vectorSearch(codeEmbedding, { ...searchOpts, model: codeModel })
    results = mergeSearchResults(textResults, codeResults, topK)
  } else {
    // Single-model search (backward-compatible)
    results = vectorSearch(textEmbedding, searchOpts)
  }

  if (groupMode) {
    results = groupResults(results, groupMode, topK)
  }

  console.log(renderResults(results))
}

