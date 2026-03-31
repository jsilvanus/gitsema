import { runIndex, type IndexStats } from '../../core/indexing/indexer.js'
import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { DEFAULT_MAX_SIZE } from '../../core/git/showBlob.js'
import type { ChunkStrategy } from '../../core/chunking/chunker.js'

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function renderProgress(stats: IndexStats): string {
  const processed = stats.indexed + stats.oversized + stats.failed

  if (stats.queued === 0) {
    // Either still in the collection phase, or collection finished with nothing new to embed.
    // Use commits > 0 to distinguish Phase B (commit mapping) from Phase A (collecting).
    if (stats.commits > 0) {
      return `\r  Mapping commits... commits=${stats.commits} links=${stats.blobCommits}  `
    }
    return (
      `\r  Collecting... seen=${stats.seen} skip=${stats.skipped} filt=${stats.filtered}  `
    )
  }

  // queued > 0 here, so division is safe.
  if (processed >= stats.queued) {
    // Phase B: commit metadata mapping
    return `\r  Mapping commits... commits=${stats.commits} links=${stats.blobCommits}  `
  }

  // Embedding phase: render a progress bar.
  const pct = processed / stats.queued
  const barWidth = 20
  const filled = Math.round(pct * barWidth)
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)
  const pctStr = (pct * 100).toFixed(0).padStart(3)
  const rate = stats.elapsed > 0 ? ((stats.indexed / stats.elapsed) * 1000).toFixed(1) : '0'
  const remaining = stats.queued - processed
  const eta =
    stats.indexed > 0 && stats.elapsed > 0
      ? formatMs((stats.elapsed / stats.indexed) * remaining)
      : '?'
  return (
    `\r  [${bar}] ${pctStr}%` +
    ` new=${stats.indexed} skip=${stats.skipped} filt=${stats.filtered} over=${stats.oversized} fail=${stats.failed}` +
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
  maxCommits?: string
  ext?: string
  maxSize?: string
  exclude?: string
  chunker?: string
  windowSize?: string
  overlap?: string
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

  // Parse max-commits
  let maxCommits: number | undefined
  if (options.maxCommits !== undefined) {
    maxCommits = parseInt(options.maxCommits, 10)
    if (isNaN(maxCommits) || maxCommits < 1) {
      console.error('Error: --max-commits must be a positive integer')
      process.exit(1)
    }
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

  // Parse chunker strategy
  let chunkerStrategy: ChunkStrategy = 'file'
  if (options.chunker !== undefined) {
    if (options.chunker !== 'file' && options.chunker !== 'function' && options.chunker !== 'fixed') {
      console.error('Error: --chunker must be one of: file, function, fixed')
      process.exit(1)
    }
    chunkerStrategy = options.chunker as ChunkStrategy
  }

  // Parse chunker options (only relevant for `fixed` strategy)
  let windowSize: number | undefined
  if (options.windowSize !== undefined) {
    windowSize = parseInt(options.windowSize, 10)
    if (isNaN(windowSize) || windowSize < 1) {
      console.error('Error: --window-size must be a positive integer')
      process.exit(1)
    }
  }
  let overlap: number | undefined
  if (options.overlap !== undefined) {
    overlap = parseInt(options.overlap, 10)
    if (isNaN(overlap) || overlap < 0) {
      console.error('Error: --overlap must be a non-negative integer')
      process.exit(1)
    }
  }

  if (codeProvider) {
    console.log(`Indexing with ${providerType} — text: ${textModel}, code: ${codeModel}`)
  } else {
    console.log(`Indexing with ${providerType}/${textModel}...`)
  }
  if (chunkerStrategy !== 'file') {
    console.log(`  Chunker: ${chunkerStrategy}${windowSize !== undefined ? ` (window=${windowSize})` : ''}${overlap !== undefined ? ` (overlap=${overlap})` : ''}`)
  }
  if (options.since) {
    console.log(`  Limiting to commits after: ${options.since}`)
  }
  if (maxCommits !== undefined) {
    console.log(`  Max commits per session: ${maxCommits}`)
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
    maxCommits,
    maxBlobSize,
    filter: { ext, exclude },
    chunker: chunkerStrategy,
    chunkerOptions: { windowSize, overlap },
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
  if (chunkerStrategy !== 'file') {
    console.log(`  Chunk embeddings:    ${stats.chunks}`)
  }
  console.log(`  Commits mapped:      ${stats.commits}`)
  console.log(`  Blob-commit links:   ${stats.blobCommits}`)
}
