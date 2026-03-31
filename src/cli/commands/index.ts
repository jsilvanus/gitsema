import { runIndex, type IndexStats } from '../../core/indexing/indexer.js'
import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { DEFAULT_MAX_SIZE, showBlob } from '../../core/git/showBlob.js'
import { resolveBlobAtRef } from '../../core/search/evolution.js'
import { getFileCategory } from '../../core/embedding/fileType.js'
import { storeBlob, storeBlobRecord, storeChunk } from '../../core/indexing/blobStore.js'
import { createChunker } from '../../core/chunking/chunker.js'
import { createLimiter } from '../../utils/concurrency.js'
import { logger } from '../../utils/logger.js'
import type { ChunkStrategy } from '../../core/chunking/chunker.js'
import { execSync } from 'node:child_process'
import { resolve as pathResolve, relative as pathRelative } from 'node:path'

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export async function indexFileCommand(filePath: string, options: { chunker?: string } = {}): Promise<void> {
  if (!filePath || filePath.trim() === '') {
    console.error('Error: file path is required')
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

  // Resolve blob at HEAD; if running from a subdirectory `filePath` may be
  // relative to cwd rather than the repo root. Try git's prefix and repo root
  // as a fallback when the initial lookup fails.
  let blob = await resolveBlobAtRef('HEAD', filePath)
  let resolvedPath = filePath
  let repoRoot = '.'
  if (!blob) {
    try {
      repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
      const prefix = execSync('git rev-parse --show-prefix', { encoding: 'utf8' }).trim()
      const rel = (prefix + filePath).replace(/\\/g, '/')
      if (rel && rel !== filePath) {
        const alt = await resolveBlobAtRef('HEAD', rel, repoRoot)
        if (alt) {
          blob = alt
          resolvedPath = rel
        }
      }
    } catch {
      // ignore git errors
    }
  }

  if (!blob) {
    console.error(`File not found at HEAD: ${filePath}`)
    process.exit(1)
  }

  let content: Buffer | null
  try {
    content = await showBlob(blob, repoRoot, DEFAULT_MAX_SIZE)
  } catch (err) {
    console.error(`Error reading blob: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (content === null) {
    console.error('Blob is oversized; consider using `--chunker fixed` with smaller windows')
    process.exit(1)
  }

  const text = content.toString('utf8')
  const fileType = getFileCategory(resolvedPath)

  // If the caller requested chunking explicitly, use chunked path.
  const requestedChunker = options.chunker
  if (requestedChunker && requestedChunker !== 'file') {
    const chunker = createChunker(requestedChunker as any, {})
    const blobChunks = chunker.chunk(text, filePath)

    try {
      storeBlobRecord({ blobHash: blob, size: content.length, path: filePath, content: text })
    } catch (err) {
      console.error(`Failed to store blob record ${blob}: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }

    let allOk = true
    for (const chunk of blobChunks) {
      try {
        const emb = await provider.embed(chunk.content)
        storeChunk({ blobHash: blob, startLine: chunk.startLine, endLine: chunk.endLine, model: (provider as any).model, embedding: emb })
      } catch (err) {
        console.error(`Embedding failed for chunk ${chunk.startLine}-${chunk.endLine}: ${err instanceof Error ? err.message : String(err)}`)
        allOk = false
      }
    }

    if (allOk) {
      console.log(`Indexed blob ${blob} (chunked) for file ${filePath}`)
      return
    }
    console.error('One or more chunk embeddings failed')
    process.exit(1)
  }

  // Default: try whole-file embed, then fall back to function -> fixed windows on context errors
  try {
    const embedding = await provider.embed(text)
    storeBlob({ blobHash: blob, size: content.length, path: filePath, model: (provider as any).model, embedding, fileType, content: text })
    console.log(`Indexed blob ${blob} for file ${filePath}`)
    return
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Embedding failed for blob ${blob}: ${msg}`)

    if (typeof msg === 'string' && /context|input length|exceeds the context/i.test(msg)) {
      console.error(`Attempting function-chunker fallback for blob ${blob}`)

      const fallbackChunker = createChunker('function', {})
      const blobChunks = fallbackChunker.chunk(text, filePath)

      try {
        storeBlobRecord({ blobHash: blob, size: content.length, path: filePath, content: text })
      } catch (err2) {
        console.error(`Failed to store blob record (fallback) ${blob}: ${err2 instanceof Error ? err2.message : String(err2)}`)
        process.exit(1)
      }

      let allOk = true
      for (const chunk of blobChunks) {
        try {
          const chunkEmbedding = await provider.embed(chunk.content)
          storeChunk({ blobHash: blob, startLine: chunk.startLine, endLine: chunk.endLine, model: (provider as any).model, embedding: chunkEmbedding })
        } catch (err3) {
          const msg3 = err3 instanceof Error ? err3.message : String(err3)
          console.error(`Embedding failed for blob ${blob} chunk ${chunk.startLine}-${chunk.endLine}: ${msg3}`)

          if (typeof msg3 === 'string' && /context|input length|exceeds the context/i.test(msg3)) {
            const fixedSizes = [1500, 800]
            let fixedSucceeded = false
            for (const size of fixedSizes) {
              console.error(`Attempting fixed-chunker (window=${size}) fallback for blob ${blob} chunk ${chunk.startLine}-${chunk.endLine}`)
              const fixedChunker = createChunker('fixed', { windowSize: size, overlap: 200 })
              const subChunks = fixedChunker.chunk(chunk.content, filePath)
              let subAllOk = true
              for (const sub of subChunks) {
                try {
                  const subEmb = await provider.embed(sub.content)
                  const absStart = chunk.startLine + sub.startLine - 1
                  const absEnd = chunk.startLine + sub.endLine - 1
                  storeChunk({ blobHash: blob, startLine: absStart, endLine: absEnd, model: (provider as any).model, embedding: subEmb })
                } catch (err5) {
                  console.error(`Embedding failed for subchunk: ${err5 instanceof Error ? err5.message : String(err5)}`)
                  subAllOk = false
                }
              }
              if (subAllOk) {
                fixedSucceeded = true
                break
              }
            }

            if (fixedSucceeded) {
              continue
            }
          }

          allOk = false
        }
      }

      if (allOk) {
        console.log(`Indexed blob ${blob} (chunked fallback) for file ${filePath}`)
        return
      }
      console.error('Fallback attempts failed for some chunks')
      process.exit(1)
    }

    console.error('Embedding failed and is not recoverable')
    process.exit(1)
  }
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
  file?: string[]
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
    logger.info(`Indexing with ${providerType}/${textModel}...`)
  }
  if (chunkerStrategy !== 'file') {
    console.log(`  Chunker: ${chunkerStrategy}${windowSize !== undefined ? ` (window=${windowSize})` : ''}${overlap !== undefined ? ` (overlap=${overlap})` : ''}`)
  }
  if (options.since) logger.info(`  Limiting to commits after: ${options.since}`)
  if (maxCommits !== undefined) logger.info(`  Max commits per session: ${maxCommits}`)
  if (concurrency !== 4) logger.info(`  Concurrency: ${concurrency}`)
  if (ext && ext.length > 0) logger.info(`  Extensions: ${ext.join(', ')}`)
  if (exclude && exclude.length > 0) logger.info(`  Excluding: ${exclude.join(', ')}`)

  // If specific files were requested, index them (parallel up to --concurrency) and return.
  if (options.file && options.file.length > 0) {
    const limiter = createLimiter(concurrency)
    await Promise.all(
      options.file.map((p) => limiter(() => indexFileCommand(p, { chunker: chunkerStrategy === 'file' ? undefined : chunkerStrategy })))
    )
    return
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
  console.log(`    Embed errors:      ${stats.embedFailed}`)
  console.log(`    Other errors:      ${stats.otherFailed}`)
  if (chunkerStrategy !== 'file') {
    console.log(`  Chunk embeddings:    ${stats.chunks}`)
  }
  console.log(`  Commits mapped:      ${stats.commits}`)
  console.log(`  Blob-commit links:   ${stats.blobCommits}`)
}
