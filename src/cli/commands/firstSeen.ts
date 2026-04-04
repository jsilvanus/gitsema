import { writeFileSync } from 'node:fs'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { renderFirstSeenResults } from '../../core/search/ranking.js'
import { remoteFirstSeen } from '../../client/remoteClient.js'

export interface FirstSeenCommandOptions {
  top?: string
  remote?: string
  branch?: string
  /**
   * When present, write JSON output.  A string value is the output file path;
   * boolean `true` means print JSON to stdout.
   */
  dump?: string | boolean
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
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

  let provider: EmbeddingProvider
  try {
    provider = buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
  }

  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedQuery(provider, query)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
    throw err
  }

  // Get top-k results by semantic similarity; vectorSearch populates firstSeen/firstCommit.
  // renderFirstSeenResults re-sorts by earliest date so the output shows when each
  // concept first appeared in the codebase.
  const results = vectorSearch(queryEmbedding, { topK, branch: options.branch })

  if (options.dump !== undefined) {
    const json = JSON.stringify(results, null, 2)
    if (typeof options.dump === 'string') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`First-seen results JSON written to: ${options.dump}`)
    } else {
      process.stdout.write(json + '\n')
    }
    return
  }

  console.log(renderFirstSeenResults(results))
}
