/**
 * Standalone test script: embed a string and print the vector length.
 * Usage: pnpm tsx scripts/embed.ts [text]
 */
import { OllamaProvider } from '../src/core/embedding/local.js'
import { HttpProvider } from '../src/core/embedding/http.js'

const text = process.argv[2] ?? 'function authenticateUser(token: string): boolean'

const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

let provider
if (providerType === 'http') {
  const baseUrl = process.env.GITSEMA_HTTP_URL
  if (!baseUrl) {
    console.error('GITSEMA_HTTP_URL required for http provider')
    process.exit(1)
  }
  provider = new HttpProvider({ baseUrl, model, apiKey: process.env.GITSEMA_API_KEY })
} else {
  provider = new OllamaProvider({ model })
}

console.log(`Provider: ${providerType}`)
console.log(`Model:    ${model}`)
console.log(`Input:    "${text}"`)
console.log()

try {
  const embedding = await provider.embed(text)
  console.log(`Vector length: ${embedding.length}`)
  console.log(`First 5 dims:  [${embedding.slice(0, 5).map((v) => v.toFixed(6)).join(', ')}]`)
} catch (err) {
  console.error(`Embed failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
