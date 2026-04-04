import { writeFileSync } from 'node:fs'
import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import { computeBranchDiff } from '../../core/search/branchDiff.js'

export interface BranchDiffCommandOptions {
  top?: string
  query?: string
  dump?: string | boolean
}

export async function branchDiffCommand(branch1: string, branch2: string, options: BranchDiffCommandOptions): Promise<void> {
  const topK = options.top !== undefined ? parseInt(options.top, 10) : 20
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  let queryEmbedding: number[] | undefined
  if (options.query) {
    const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
    const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
    let provider
    if (providerType === 'http') {
      const baseUrl = process.env.GITSEMA_HTTP_URL
      if (!baseUrl) {
        console.error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
        process.exit(1)
      }
      provider = new HttpProvider({ baseUrl, model: textModel, apiKey: process.env.GITSEMA_API_KEY })
    } else {
      provider = new OllamaProvider({ model: textModel })
    }

    try {
      queryEmbedding = await provider.embed(options.query)
    } catch (err) {
      console.error(`Error: could not embed query — ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  const result = computeBranchDiff(branch1, branch2, { topK, queryEmbedding })

  // Render human-readable output
  console.log(`Branch diff: ${branch1} vs ${branch2}\n`)

  console.log(`Unique to ${branch1} (${result.uniqueToBranch1.length} blobs):`)
  for (const e of result.uniqueToBranch1) {
    console.log(`  ${e.path}`)
  }
  console.log('')
  console.log(`Unique to ${branch2} (${result.uniqueToBranch2.length} blobs):`)
  for (const e of result.uniqueToBranch2) {
    console.log(`  ${e.path}`)
  }
  console.log('')
  console.log(`Shared blobs: ${result.shared}`)

  if (options.dump !== undefined) {
    const out = JSON.stringify(result, null, 2)
    if (typeof options.dump === 'string') {
      try {
        writeFileSync(options.dump, out, 'utf8')
        console.log(`Wrote branch-diff JSON to ${options.dump}`)
      } catch (err) {
        console.error(`Error writing dump file: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
    } else {
      console.log(out)
    }
  }
}
