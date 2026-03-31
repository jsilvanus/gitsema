import { runIndex, type IndexStats } from '../../core/indexing/indexer.js'
import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function renderProgress(stats: IndexStats): string {
  const total = stats.seen
  const done = stats.indexed + stats.skipped + stats.oversized + stats.failed
  const rate = stats.elapsed > 0 ? ((stats.indexed / stats.elapsed) * 1000).toFixed(1) : '0'
  const eta =
    stats.indexed > 0 && stats.elapsed > 0
      ? formatMs(((stats.elapsed / stats.indexed) * (total - done)))
      : '?'
  return (
    `\r  seen=${total} new=${stats.indexed} skip=${stats.skipped}` +
    ` over=${stats.oversized} fail=${stats.failed}` +
    ` ${rate}/s eta=${eta}  `
  )
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

export async function indexCommand(): Promise<void> {
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'

  // Text model (default, also used for unrecognised file types)
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  // Code model — defaults to the text model when not set, keeping single-model behaviour
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel

  const textProvider = buildProvider(providerType, textModel)
  // Only build a separate code provider when the models differ
  const codeProvider = codeModel !== textModel ? buildProvider(providerType, codeModel) : undefined

  if (codeProvider) {
    console.log(`Indexing with ${providerType} — text: ${textModel}, code: ${codeModel}`)
  } else {
    console.log(`Indexing with ${providerType}/${textModel}...`)
  }

  let lastLine = ''
  const stats = await runIndex({
    repoPath: '.',
    provider: textProvider,
    codeProvider,
    onProgress: (s) => {
      lastLine = renderProgress(s)
      process.stdout.write(lastLine)
    },
  })

  // Clear progress line
  if (lastLine) process.stdout.write('\r' + ' '.repeat(lastLine.length) + '\r')

  console.log(`Done in ${formatMs(stats.elapsed)}`)
  console.log(`  Blobs seen:     ${stats.seen}`)
  console.log(`  Newly indexed:  ${stats.indexed}`)
  console.log(`  Already in DB:  ${stats.skipped}`)
  console.log(`  Oversized:      ${stats.oversized}`)
  console.log(`  Failed:         ${stats.failed}`)
}
