import { runIndex, type IndexStats } from '../../core/indexing/indexer.js'
import { runRemoteIndex } from '../../core/indexing/remoteIndexer.js'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { DEFAULT_MAX_SIZE, showBlob } from '../../core/git/showBlob.js'
import { resolveBlobAtRef } from '../../core/search/evolution.js'
import { getFileCategory } from '../../core/embedding/fileType.js'
import { storeBlob, storeBlobRecord, storeChunk, getLastIndexedCommit } from '../../core/indexing/blobStore.js'
import { createChunker } from '../../core/chunking/chunker.js'
import { createLimiter } from '../../utils/concurrency.js'
import { logger } from '../../utils/logger.js'
import type { ChunkStrategy } from '../../core/chunking/chunker.js'
import { execSync } from 'node:child_process'
import { resolve as pathResolve, relative as pathRelative } from 'node:path'
import { buildVssCommand } from './buildVss.js'
import { computeConfigHash, saveEmbedConfig, checkConfigCompatibility, type EmbedConfig } from '../../core/indexing/provenance.js'
import { getRawDb } from '../../core/db/sqlite.js'

/**
 * Format a duration in milliseconds as a human-friendly string.
 * Examples:
 *   234     → "234ms"
 *   12300   → "12.3s"
 *   125000  → "2m 05s"
 *   3662000 → "1h 01m 02s"
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSecs = Math.floor(ms / 1000)
  if (totalSecs < 60) return `${(ms / 1000).toFixed(1)}s`
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}h ${mm}m ${ss}s`
  return `${m}m ${ss}s`
}

function formatMs(ms: number): string {
  return formatElapsed(ms)
}

export async function indexFileCommand(filePath: string, options: { chunker?: string } = {}): Promise<void> {
  if (!filePath || filePath.trim() === '') {
    console.error('Error: file path is required')
    process.exit(1)
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

  let provider: EmbeddingProvider
  try {
    provider = buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
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
    logger.debug?.(`Embedding failed for blob ${blob}: ${msg}`)

    if (typeof msg === 'string' && /context|input length|exceeds the context/i.test(msg)) {
      // record a function fallback attempt; verbose shows details
      let fbFunction = 0
      let fbFixed = 0
      fbFunction++
      logger.debug?.(`Attempting function-chunker fallback for blob ${blob}`)

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
              fbFixed++
              logger.debug?.(`Attempting fixed-chunker (window=${size}) fallback for blob ${blob} chunk ${chunk.startLine}-${chunk.endLine}`)
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
      logger.debug('Fallback attempts failed for some chunks')
      console.error(`Fallback attempts failed for some chunks (fail=1 fb=${fbFunction}/${fbFixed})`)
      process.exit(1)
    }

    console.error(`Embedding failed and is not recoverable (fail=1)`)
    process.exit(1)
  }
}

function renderProgress(stats: IndexStats): string {
  const elapsed = stats.elapsed
  const elapsedStr = formatElapsed(elapsed)
  const stage = stats.currentStage ?? 'collecting'

  if (stage === 'collecting' || (stats.queued === 0 && stats.commits === 0)) {
    return `\r  [collecting] seen=${stats.seen} skip=${stats.skipped} filt=${stats.filtered}  elapsed=${elapsedStr}  `
  }

  if (stage === 'commit-mapping' || (stats.queued > 0 && (stats.indexed + stats.oversized + stats.failed) >= stats.queued)) {
    return `\r  [commit-mapping] commits=${stats.commits} links=${stats.blobCommits}  elapsed=${elapsedStr}  `
  }

  // Embedding phase: render a progress bar.
  const processed = stats.indexed + stats.oversized + stats.failed
  const pct = stats.queued > 0 ? processed / stats.queued : 0
  const barWidth = 16
  const filled = Math.round(pct * barWidth)
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)
  const pctStr = (pct * 100).toFixed(0).padStart(3)
  const rate = elapsed > 0 ? ((stats.indexed / elapsed) * 1000).toFixed(1) : '0.0'
  const remaining = stats.queued - processed
  const eta =
    stats.indexed > 0 && elapsed > 0
      ? formatElapsed((elapsed / stats.indexed) * remaining)
      : '?'
  const latencyPart =
    stats.embedLatencyAvgMs > 0
      ? ` avg=${stats.embedLatencyAvgMs}ms p95=${stats.embedLatencyP95Ms}ms`
      : ''
  return (
    `\r  [embedding] [${bar}] ${pctStr}% ${processed}/${stats.queued}` +
    `  rate=${rate}/s${latencyPart} eta=${eta}  elapsed=${elapsedStr}  `
  )
}

function buildProviderOrExit(providerType: string, model: string): EmbeddingProvider {
  try {
    return buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
  }
}

/**
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
  includeGlob?: string
  chunker?: string
  windowSize?: string
  overlap?: string
  embedBatchSize?: string
  file?: string[]
  remote?: string
  branch?: string
  // CLI model overrides
  model?: string
  textModel?: string
  codeModel?: string
  quantize?: boolean
  buildVss?: boolean
  allowMixed?: boolean
}

export async function indexCommand(options: IndexCommandOptions): Promise<void> {
  // Apply CLI model overrides so provider factories pick them up
  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

  // Remote mode: ship blobs to a gitsema server instead of embedding locally
  const remoteUrl = options.remote ?? process.env.GITSEMA_REMOTE
  if (remoteUrl) {
    process.env.GITSEMA_REMOTE = remoteUrl

    // Parse options shared with remote path
    const concurrency = options.concurrency !== undefined ? parseInt(options.concurrency, 10) : 4
    let maxCommits: number | undefined
    if (options.maxCommits !== undefined) {
      maxCommits = parseInt(options.maxCommits, 10)
      if (isNaN(maxCommits) || maxCommits < 1) {
        console.error('Error: --max-commits must be a positive integer')
        process.exit(1)
      }
    }
    let maxBlobSize: number = DEFAULT_MAX_SIZE
    if (options.maxSize !== undefined) {
      try { maxBlobSize = parseSize(options.maxSize) } catch (err) {
        console.error(`Error: --max-size ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
    }
    const ext = options.ext
      ? options.ext.split(',').map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
      : undefined
    const exclude = options.exclude
      ? options.exclude.split(',').map((e) => e.trim()).filter(Boolean)
      : undefined
    const includeGlob = options.includeGlob
      ? options.includeGlob.split(',').map((e) => e.trim()).filter(Boolean)
      : undefined

    console.log(`Remote indexing → ${remoteUrl}`)
    if (options.since) logger.info(`  Since: ${options.since}`)

    let lastLine = ''
    const stats = await runRemoteIndex({
      repoPath: '.',
      since: options.since,
      concurrency,
      maxCommits,
      maxBlobSize,
      filter: { ext, exclude, includeGlob },
      onProgress: (s) => {
        lastLine = renderProgress(s)
        process.stdout.write(lastLine)
      },
    })

    if (lastLine) process.stdout.write('\r' + ' '.repeat(lastLine.length) + '\r')
    console.log(`Done in ${formatMs(stats.elapsed)}`)
    console.log(`  Blobs seen:        ${stats.seen}`)
    console.log(`  Uploaded:          ${stats.indexed}`)
    console.log(`  Already on server: ${stats.skipped}`)
    console.log(`  Oversized:         ${stats.oversized}`)
    console.log(`  Filtered out:      ${stats.filtered}`)
    console.log(`  Failed:            ${stats.failed}`)
    console.log(`  Commits mapped:    ${stats.commits}`)
    return
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'

  // Text model (default, also used for unrecognised file types)
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  // Code model — defaults to the text model when not set, keeping single-model behaviour
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel

  const textProvider = buildProviderOrExit(providerType, textModel)
  // Only build a separate code provider when the models differ
  const codeProvider = codeModel !== textModel ? buildProviderOrExit(providerType, codeModel) : undefined

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
  const includeGlob = options.includeGlob
    ? options.includeGlob.split(',').map((e) => e.trim()).filter(Boolean)
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

  let embedBatchSize: number | undefined
  if (options.embedBatchSize !== undefined) {
    embedBatchSize = parseInt(options.embedBatchSize, 10)
    if (isNaN(embedBatchSize) || embedBatchSize < 1) {
      console.error('Error: --embed-batch-size must be a positive integer')
      process.exit(1)
    }
  }

  // Provenance / compatibility check: build an embed config and check for existing incompatible configs
  try {
    const rawDb = getRawDb()
    const embedConfigPartial: EmbedConfig = {
      provider: providerType,
      model: textModel,
      codeModel: codeModel !== textModel ? codeModel : undefined,
      dimensions: textProvider.dimensions || 0,
      chunker: chunkerStrategy,
      windowSize: windowSize,
      overlap: overlap,
    }

    // Probe provider to discover dimensions if unset
    if (!embedConfigPartial.dimensions) {
      try {
        await textProvider.embed('ping')
        embedConfigPartial.dimensions = textProvider.dimensions
      } catch {
        // ignore probe failures — will be caught during actual indexing
      }
    }

    const compat = checkConfigCompatibility(rawDb, embedConfigPartial)
    if (!compat.compatible && !options.allowMixed) {
      console.error('Embedding configuration is incompatible with existing index:')
      console.error(compat.reason)
      process.exit(1)
    }
  } catch (err) {
    // Do not fail the whole command on provenance check errors — log and continue
    logger.debug?.(`Provenance check failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (codeProvider) {
    console.log(`Indexing with ${providerType} — text: ${textModel}, code: ${codeModel}`)
  } else {
    console.log(`Indexing with ${providerType}/${textModel}`)
  }
  if (chunkerStrategy !== 'file') {
    console.log(`  Chunker: ${chunkerStrategy}${windowSize !== undefined ? ` (window=${windowSize})` : ''}${overlap !== undefined ? ` (overlap=${overlap})` : ''}`)
  }

  // Determine and print the indexing mode (incremental vs full)
  if (options.since === 'all') {
    console.log('  Mode: full re-index (--since all)')
  } else if (options.since) {
    console.log(`  Mode: incremental from ${options.since}`)
  } else {
    const lastCommit = getLastIndexedCommit()
    if (lastCommit) {
      console.log(`  Mode: incremental (resuming from ${lastCommit.substring(0, 8)})`)
    } else {
      console.log('  Mode: full (no prior index found — indexing from scratch)')
    }
  }

  if (options.branch) logger.info(`  Branch filter: ${options.branch}`)
  if (maxCommits !== undefined) logger.info(`  Max commits per session: ${maxCommits}`)
  logger.info(`  Concurrency: ${concurrency} (parallel embedding calls)`)
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
    filter: { ext, exclude, includeGlob },
    chunker: chunkerStrategy,
    chunkerOptions: { windowSize, overlap },
    branchFilter: options.branch,
    onProgress: (s) => {
      lastLine = renderProgress(s)
      process.stdout.write(lastLine)
    },
    quantize: options.quantize,
    embedBatchSize,
  })

  // Clear progress line
  if (lastLine) process.stdout.write('\r' + ' '.repeat(lastLine.length) + '\r')

  console.log(`Done in ${formatElapsed(stats.elapsed)}`)

  // Persist embed config provenance (record actual dimensions when available)
  try {
    const rawDb = getRawDb()
    let dims = textProvider.dimensions || 0
    if (!dims) {
      const row = rawDb.prepare('SELECT dimensions FROM embeddings WHERE model = ? LIMIT 1').get(textModel) as { dimensions?: number } | undefined
      if (row && row.dimensions) dims = row.dimensions
    }
    if (dims) {
      const embedConfigToSave: EmbedConfig = {
        provider: providerType,
        model: textModel,
        codeModel: codeModel !== textModel ? codeModel : undefined,
        dimensions: dims,
        chunker: chunkerStrategy,
        windowSize: windowSize,
        overlap: overlap,
      }
      saveEmbedConfig(getRawDb(), embedConfigToSave)
    }
  } catch (err) {
    logger.debug?.(`Failed to save embed config provenance: ${err instanceof Error ? err.message : String(err)}`)
  }
  console.log(`  Blobs seen:          ${stats.seen}`)
  console.log(`  Newly indexed:       ${stats.indexed}`)
  console.log(`  Already in DB:       ${stats.skipped}`)
  console.log(`  Oversized:           ${stats.oversized}`)
  console.log(`  Filtered out:        ${stats.filtered}`)
  console.log(`  Failed:              ${stats.failed}  fb=${stats.fbFunction}/${stats.fbFixed}`)
  console.log(`    Embed errors:      ${stats.embedFailed}`)
  console.log(`    Other errors:      ${stats.otherFailed}`)
  if (chunkerStrategy !== 'file') {
    console.log(`  Chunk embeddings:    ${stats.chunks}`)
  }
  console.log(`  Commits mapped:      ${stats.commits}`)
  console.log(`  Blob-commit links:   ${stats.blobCommits}`)
  console.log(`  Commit embeddings:   ${stats.commitEmbeddings}`)
  if (stats.commitEmbedFailed > 0) {
    console.log(`  Commit embed failed: ${stats.commitEmbedFailed}`)
  }
  // Stage timings breakdown
  if (stats.stageTimings) {
    console.log('  Stage timings:')
    console.log(`    Collection:      ${formatElapsed(stats.stageTimings.collection)}  (${stats.seen} blobs seen)`)
    console.log(`    Embedding:       ${formatElapsed(stats.stageTimings.embedding)}  (${stats.indexed} indexed, ${stats.skipped} skipped)`)
    console.log(`    Commit mapping:  ${formatElapsed(stats.stageTimings.commitMapping)}  (${stats.commits} commits)`)
  }
  // Embedding latency report
  if (stats.embedLatencyAvgMs > 0) {
    console.log('  Embedding latency:')
    console.log(`    Avg: ${stats.embedLatencyAvgMs}ms   P95: ${stats.embedLatencyP95Ms}ms`)
  }

  // Optionally build VSS index after indexing
  if (options.buildVss) {
    const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
    await buildVssCommand({ model: textModel })
  }
}
