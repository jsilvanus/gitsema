import { runIndex, type IndexStats } from '../../core/indexing/indexer.js'
import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { DEFAULT_MAX_SIZE } from '../../core/git/showBlob.js'

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function renderProgress(stats: IndexStats): string {
  const total = stats.seen
  const done = stats.indexed + stats.skipped + stats.oversized + stats.filtered + stats.failed
  const rate = stats.elapsed > 0 ? ((stats.indexed / stats.elapsed) * 1000).toFixed(1) : '0'
  const eta =
    stats.indexed > 0 && stats.elapsed > 0
      ? formatMs(((stats.elapsed / stats.indexed) * (total - done)))
      : '?'
  return (
    `\r  seen=${total} new=${stats.indexed} skip=${stats.skipped}` +
    ` over=${stats.oversized} filt=${stats.filtered} fail=${stats.failed}` +
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

/**
 * Parses a human-friendly size string (e.g. `"200kb"`, `"1mb"`, `"512"`) into bytes.
 * Returns undefined when the input is undefined.
 * Throws on unrecognisable formats.
 */
function parseSize(value: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value.trim())
  if (!m) throw new Error(`Invalid size: "${value}". Expected e.g. 200kb, 1mb, or a plain number of bytes.`)
  const n = parseFloat(m[1])
  const unit = (m[2] ?? 'b').toLowerCase()
  const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }
  return Math.round(n * multipliers[unit])
}

export interface IndexCommandOptions {
  since?: string
  concurrency?: string
  ext?: string
  maxSize?: string
  exclude?: string
}

export async function indexCommand(options: IndexCommandOptions): Promise<void> {
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'

  // Text model (default, also used for unrecognised file types)
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  // Code model — defaults to the text model when not set, keeping single-model behaviour
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel

  const textProvider = buildProvider(providerType, textModel)
  // Only build a separate code provider when the models differ
  const codeProvider = codeModel !== textModel ? buildProvider(providerType, codeModel) : undefined

  // Parse concurrency
  const concurrency = options.concurrency !== undefined ? parseInt(options.concurrency, 10) : 4
  if (isNaN(concurrency) || concurrency < 1) {
    console.error('Error: --concurrency must be a positive integer')
    process.exit(1)
  }

  // Parse max-size
  let maxBlobSize: number = DEFAULT_MAX_SIZE
  if (options.maxSize !== undefined) {
    try {
      maxBlobSize = parseSize(options.maxSize)
    } catch (err) {
      console.error(`Error: --max-size ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  // Parse ext filter: ".ts,.js" → ['.ts', '.js']
  const ext = options.ext
    ? options.ext.split(',').map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
    : undefined

  // Parse exclude: "node_modules,dist" → ['node_modules', 'dist']
  const exclude = options.exclude
    ? options.exclude.split(',').map((e) => e.trim()).filter(Boolean)
    : undefined

  if (codeProvider) {
    console.log(`Indexing with ${providerType} — text: ${textModel}, code: ${codeModel}`)
  } else {
    console.log(`Indexing with ${providerType}/${textModel}...`)
  }
  if (options.since) {
    console.log(`  Limiting to commits after: ${options.since}`)
  }
  if (concurrency !== 4) {
    console.log(`  Concurrency: ${concurrency}`)
  }
  if (ext && ext.length > 0) {
    console.log(`  Extensions: ${ext.join(', ')}`)
  }
  if (exclude && exclude.length > 0) {
    console.log(`  Excluding: ${exclude.join(', ')}`)
  }

  let lastLine = ''
  const stats = await runIndex({
    repoPath: '.',
    provider: textProvider,
    codeProvider,
    since: options.since,
    concurrency,
    maxBlobSize,
    filter: { ext, exclude },
    onProgress: (s) => {
      lastLine = renderProgress(s)
      process.stdout.write(lastLine)
    },
  })

  // Clear progress line
  if (lastLine) process.stdout.write('\r' + ' '.repeat(lastLine.length) + '\r')

  console.log(`Done in ${formatMs(stats.elapsed)}`)
  console.log(`  Blobs seen:          ${stats.seen}`)
  console.log(`  Newly indexed:       ${stats.indexed}`)
  console.log(`  Already in DB:       ${stats.skipped}`)
  console.log(`  Oversized:           ${stats.oversized}`)
  console.log(`  Filtered out:        ${stats.filtered}`)
  console.log(`  Failed:              ${stats.failed}`)
  console.log(`  Commits mapped:      ${stats.commits}`)
  console.log(`  Blob-commit links:   ${stats.blobCommits}`)
}
