/**
 * Standalone test script: embed a string and print the vector length.
 * Usage: pnpm tsx scripts/embed.ts [text] [filePath]
 *
 * When filePath is provided the file-type router selects the appropriate model
 * automatically (code model for source files, text model for prose).
 */
import { OllamaProvider } from '../src/core/embedding/local.js'
import { HttpProvider } from '../src/core/embedding/http.js'
import { RoutingProvider } from '../src/core/embedding/router.js'
import { getFileCategory } from '../src/core/embedding/fileType.js'

const text = process.argv[2] ?? 'function authenticateUser(token: string): boolean'
const filePath = process.argv[3] // optional: used to demonstrate routing

const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel

function buildProvider(model: string) {
  if (providerType === 'http') {
    const baseUrl = process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      console.error('GITSEMA_HTTP_URL required for http provider')
      process.exit(1)
    }
    return new HttpProvider({ baseUrl, model, apiKey: process.env.GITSEMA_API_KEY })
  }
  return new OllamaProvider({ model })
}

const textProvider = buildProvider(textModel)
const codeProvider = codeModel !== textModel ? buildProvider(codeModel) : undefined

console.log(`Provider:   ${providerType}`)
if (codeProvider) {
  console.log(`Text model: ${textModel}`)
  console.log(`Code model: ${codeModel}`)
} else {
  console.log(`Model:      ${textModel}`)
}
console.log(`Input:      "${text}"`)

if (filePath) {
  const category = getFileCategory(filePath)
  console.log(`File path:  ${filePath}  →  category: ${category}`)
}
console.log()

try {
  let embedding: number[]
  let activeModel: string

  if (codeProvider && filePath) {
    const router = new RoutingProvider(textProvider, codeProvider)
    const activeProvider = router.providerForFile(filePath)
    activeModel = activeProvider.model
    embedding = await router.embedFile(text, filePath)
  } else {
    activeModel = textProvider.model
    embedding = await textProvider.embed(text)
  }

  console.log(`Active model:  ${activeModel}`)
  console.log(`Vector length: ${embedding.length}`)
  console.log(`First 5 dims:  [${embedding.slice(0, 5).map((v) => v.toFixed(6)).join(', ')}]`)
} catch (err) {
  console.error(`Embed failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
