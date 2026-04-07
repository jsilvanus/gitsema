import { revList, type BlobEntry } from '../git/revList.js'
import { showBlob, DEFAULT_MAX_SIZE } from '../git/showBlob.js'
import { streamCommitMap, type CommitEntry, type CommitMapEvent } from '../git/commitMap.js'
import { isIndexed } from './deduper.js'
import { storeBlob, storeBlobRecord, storeChunk, storeSymbol, storeCommitWithBlobs, markCommitIndexed, getLastIndexedCommit, storeBlobBranches, storeCommitEmbedding, storeModuleEmbedding, getModuleEmbedding } from './blobStore.js'
import { resolveEmbedBatchSize } from './adaptiveTuning.js'
import type { EmbeddingProvider } from '../embedding/provider.js'
import type { Embedding } from '../models/types.js'
import { RoutingProvider } from '../embedding/router.js'
import { getFileCategory } from '../embedding/fileType.js'
import { createChunker, type ChunkStrategy, type ChunkOptions } from '../chunking/chunker.js'
import { logger } from '../../utils/logger.js'
import { createLimiter } from '../../utils/concurrency.js'
import { extname, dirname } from 'node:path'
import { minimatch } from 'minimatch'

export interface FilterOptions {
  /**
   * Only index blobs whose path extension is in this list.
   * Each entry should include the leading dot, e.g. `['.ts', '.js']`.
   * When empty or omitted, all extensions are included.
   */
  ext?: string[]
  /**
   * Skip blobs whose path matches any of these substring patterns.
   * Useful for excluding `node_modules`, `dist`, `vendor`, etc.
   * When empty or omitted, no paths are excluded.
   */
  exclude?: string[]
  /** When provided, only include blobs whose path matches at least one of the supplied glob patterns (minimatch). */
  includeGlob?: string[]
}

export interface IndexerOptions {
  repoPath?: string
  maxBlobSize?: number
  provider: EmbeddingProvider
  /**
   * When provided, source code files are embedded with this model while
   * prose / documentation files use `provider`. If omitted, all files
   * use `provider` regardless of type (backward-compatible behaviour).
   */
  codeProvider?: EmbeddingProvider
  /**
   * Restrict indexing to commits after this point. Accepts:
   *  - ISO date string (e.g. `"2024-01-01"`)
   *  - Tag name (e.g. `"v1.2.0"`)
   *  - Commit hash or symbolic ref (e.g. `"HEAD~100"`, `"abc1234"`)
   *
   * When omitted and a previous index run has been recorded, defaults to the
   * last indexed commit (incremental indexing). Pass `'all'` to force a full
   * re-index regardless of previous runs.
   */
  since?: string
  /**
   * Maximum number of blobs to embed concurrently (default 4).
   */
  concurrency?: number
  /**
   * Stop after traversing this many commits.
   * Useful for splitting a large history into multiple indexing sessions —
   * run with `--max-commits 500` repeatedly and incremental indexing will
   * resume from where the previous session left off.
   */
  maxCommits?: number
  /** Path-based filter applied before any blob content is read. */
  filter?: FilterOptions
  /**
   * Chunking strategy to use when indexing blobs.
   * - `'file'` (default) — whole-file indexing, one embedding per blob (backward-compatible)
   * - `'function'` — split on function/class boundaries
   * - `'fixed'` — fixed-size windows with overlap
   */
  chunker?: ChunkStrategy
  /** Options passed to the chunker (e.g. window size and overlap for `fixed`). */
  chunkerOptions?: ChunkOptions
  /**
   * When set, restrict indexing to commits reachable from this branch only.
   * Pass a short branch name (e.g. `"main"`, `"feature/auth"`); the indexer
   * will pass `refs/heads/<name>` to `revList` and `streamCommitMap`.
   */
  branchFilter?: string
  /** When true, update module (directory) centroid embeddings inline while indexing (Phase 33). Default: true. */
  computeModuleEmbedding?: boolean
  quantize?: boolean
  /**
   * Number of texts to send in a single `embedBatch()` call when the provider
   * supports it (only used when `--chunker file`, the default).
   *
   * Set to 32–128 for HTTP providers to collapse many serial round-trips into
   * one batch request. Falls back to one-at-a-time when the provider does not
   * implement `embedBatch`, or when chunking is enabled.
   *
   * Default: 1 (no batching — backward-compatible).
   */
  embedBatchSize?: number
  /**
   * Suggested batch size from a profile preset (used for auto-batch detection
   * when `embedBatchSize` is not explicitly set by the caller).
   * @internal Used by the CLI `--profile` flag via `adaptiveTuning.resolveEmbedBatchSize`.
   */
  profileBatchSize?: number
  onProgress?: (stats: IndexStats) => void
}

export interface IndexStats {
  seen: number
  indexed: number
  skipped: number   // already in DB
  oversized: number // over size limit
  filtered: number  // excluded by path filter
  failed: number
  /** Number of failures originating from embedding provider errors */
  embedFailed: number
  /** Number of failures from other causes (I/O, DB storage, etc.) */
  otherFailed: number
  /** Fallback counts: function-chunker attempts */
  fbFunction: number
  /** Fallback counts: fixed-window attempts */
  fbFixed: number
  /**
   * Total blobs queued for embedding (set after the collection phase).
   * Zero until collection is complete. Used by the CLI to render a progress bar.
   */
  queued: number
  elapsed: number   // ms
  commits: number       // Phase 6: commits stored
  blobCommits: number   // Phase 6: blob-commit links stored
  chunks: number        // Phase 10: chunk embeddings stored
  symbols: number       // Phase 19: symbol-level embeddings stored
  /** Number of module (directory) centroid embeddings updated (Phase 33). */
  moduleEmbeddings: number
  /** Number of commit message embeddings stored (Phase 30). */
  commitEmbeddings: number
  /** Number of commit message embedding failures (Phase 30). */
  commitEmbedFailed: number
  /** Current pipeline stage (used by progress renderer) */
  currentStage: 'collecting' | 'embedding' | 'commit-mapping' | 'done'
  /** Per-stage wall-clock time in ms (set at completion) */
  stageTimings: {
    collection: number   // ms from start until queued set
    embedding: number    // ms spent in embedding phase
    commitMapping: number // ms spent in commit-mapping phase
  }
  /** Rolling average embedding latency in ms (last 200 samples) */
  embedLatencyAvgMs: number
  /** p95 embedding latency in ms (from last 200 samples) */
  embedLatencyP95Ms: number
}

/**
 * Returns true when the blob at `path` should be skipped based on the filter.
 */
function isFiltered(path: string, filter: FilterOptions): boolean {
  if (filter.ext && filter.ext.length > 0) {
    const ext = extname(path).toLowerCase()
    if (!filter.ext.includes(ext)) return true
  }
  if (filter.exclude && filter.exclude.length > 0) {
    for (const pattern of filter.exclude) {
      if (path.includes(pattern)) return true
    }
  }
  // includeGlob: when present, only include paths that match at least one glob pattern
  if (filter.includeGlob && filter.includeGlob.length > 0) {
    let matched = false
    for (const pat of filter.includeGlob) {
      try {
        if (minimatch(path, pat, { dot: true })) {
          matched = true
          break
        }
      } catch (e) {
        // ignore invalid patterns
      }
    }
    if (!matched) return true
  }
  return false
}

/**
 * Detects the programming language of a file by extension.
 * Returns a short string used as the `language` column in the `symbols` table.
 */
function detectLanguageForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'py': case 'pyi': return 'python'
    case 'go': return 'go'
    case 'rs': return 'rust'
    case 'ts': return 'typescript'
    case 'tsx': return 'tsx'
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript'
    case 'java': return 'java'
    case 'cs': return 'csharp'
    case 'kt': return 'kotlin'
    case 'scala': return 'scala'
    default: return 'other'
  }
}

/**
 * Builds the enriched text for a symbol embedding.  Including the file path,
 * symbol kind, and symbol name in the preamble lets the embedding model
 * capture the symbol's identity context alongside its code content.
 *
 * Format:
 *   // file: src/auth/jwt.ts  lines 10-25
 *   // function: validateToken
 *   <source code>
 */
function buildEnrichedText(
  filePath: string,
  startLine: number,
  endLine: number,
  symbolKind: string,
  symbolName: string,
  code: string,
): string {
  return [
    `// file: ${filePath}  lines ${startLine}-${endLine}`,
    `// ${symbolKind}: ${symbolName}`,
    code,
  ].join('\n')
}

export async function runIndex(options: IndexerOptions): Promise<IndexStats> {
  const {
    repoPath = '.',
    maxBlobSize = DEFAULT_MAX_SIZE,
    provider,
    codeProvider,
    concurrency = 4,
    maxCommits,
    filter = {},
    chunker: chunkerStrategy = 'file',
    chunkerOptions = {},
    branchFilter,
    computeModuleEmbedding = true,
    onProgress,
  } = options
  const { quantize = false } = options
  const embedBatchSize = resolveEmbedBatchSize({
    userValue: options.embedBatchSize,
    provider,
    profileBatchSize: options.profileBatchSize,
  })

  // Resolve --since: use provided value, or fall back to the last indexed commit
  // for automatic incremental indexing. The special value 'all' forces a full re-index.
  let { since } = options
  if (!since || since === '') {
    const last = getLastIndexedCommit()
    if (last) {
      since = last
    }
  } else if (since === 'all') {
    since = undefined
  }

  // Build a routing provider when a separate code model is configured.
  const router = codeProvider ? new RoutingProvider(provider, codeProvider) : null

  // Build the chunker for this run
  const chunker = createChunker(chunkerStrategy, chunkerOptions)
  const useChunking = chunkerStrategy !== 'file'
  // Symbol embeddings are only produced when the function chunker is active,
  // since that is the only strategy that extracts named declarations.
  const useSymbols = chunkerStrategy === 'function'

  // Concurrency limiter for embedding calls
  const limit = createLimiter(concurrency)

  const stats: IndexStats = {
    seen: 0, indexed: 0, skipped: 0, oversized: 0, filtered: 0, failed: 0,
    embedFailed: 0, otherFailed: 0,
    fbFunction: 0, fbFixed: 0,
    queued: 0, elapsed: 0, commits: 0, blobCommits: 0, chunks: 0, symbols: 0,
    moduleEmbeddings: 0, commitEmbeddings: 0, commitEmbedFailed: 0,
    currentStage: 'collecting',
    stageTimings: { collection: 0, embedding: 0, commitMapping: 0 },
    embedLatencyAvgMs: 0,
    embedLatencyP95Ms: 0,
  }
  const start = Date.now()
  const SIZE_CAP = 50_000
  const seenHashes = new Set<string>()
  let lastProgressTime = 0

  // Latency rolling window for embedding calls (last 200 samples)
  const embedLatencies: number[] = []
  let embedLatenciesDirty = false
  function pushLatency(lat: number) {
    embedLatencies.push(lat)
    if (embedLatencies.length > 200) embedLatencies.shift()
    // Mark dirty so avg/p95 are recomputed on the next progress tick
    embedLatenciesDirty = true
  }

  function computeLatencyStats() {
    if (!embedLatenciesDirty || embedLatencies.length === 0) return
    embedLatenciesDirty = false
    const sum = embedLatencies.reduce((a, b) => a + b, 0)
    stats.embedLatencyAvgMs = Math.round(sum / embedLatencies.length)
    const sorted = [...embedLatencies].sort((a, b) => a - b)
    const idx = Math.max(0, Math.ceil(0.95 * sorted.length) - 1)
    stats.embedLatencyP95Ms = Math.round(sorted[idx] ?? 0)
  }

  function reportProgress() {
    const now = Date.now()
    if (now - lastProgressTime >= 100) {
      lastProgressTime = now
      computeLatencyStats()
      onProgress?.({ ...stats, elapsed: now - start })
    }
  }

  const stream = revList(repoPath, { since, maxCommits, branch: branchFilter })

  // Collect blobs first so we can fan-out embedding calls concurrently
  const blobsToProcess: BlobEntry[] = []
  const collectionStart = Date.now()

  for await (const entry of stream as AsyncIterable<BlobEntry>) {
    const { blobHash, path } = entry

    // Deduplicate within this run (same blob at multiple paths)
    if (seenHashes.has(blobHash)) continue
    seenHashes.add(blobHash)
    stats.seen++
    // Prevent seenHashes from growing unbounded — clear periodically (within-run dedup is best-effort)
    if (seenHashes.size > SIZE_CAP) seenHashes.clear()

    // Path-based filter (applied before any I/O)
    if (isFiltered(path, filter)) {
      stats.filtered++
      onProgress?.({ ...stats, elapsed: Date.now() - start })
      continue
    }

    // Skip blobs already indexed with the model that would be used for this path
    const wouldUseModel = router ? router.providerForFile(path).model : provider.model
    if (isIndexed(blobHash, wouldUseModel)) {
      stats.skipped++
      onProgress?.({ ...stats, elapsed: Date.now() - start })
      continue
    }

    blobsToProcess.push(entry)
  }

  // Expose the total work queue so callers can render a progress bar.
  stats.queued = blobsToProcess.length
  // mark collection timing and transition to embedding
  stats.stageTimings.collection = Date.now() - collectionStart
  stats.currentStage = 'embedding'
  onProgress?.({ ...stats, elapsed: Date.now() - start })

  // Process blobs concurrently up to the configured limit.
  const embeddingStart = Date.now()

  // helper to time embedding calls and update rolling window
  async function timedEmbed(provider: EmbeddingProvider, input: string) {
    const t0 = Date.now()
    const res = await provider.embed(input)
    const lat = Date.now() - t0
    pushLatency(lat)
    return res
  }

  // ---------------------------------------------------------------------------
  // Batch embedding path (whole-file + single provider only)
  // When embedBatchSize > 1, the provider implements embedBatch, and no
  // chunker is active, we collapse N HTTP round-trips into N/batchSize calls.
  // This dramatically improves throughput for local HTTP providers.
  // ---------------------------------------------------------------------------
  const useBatchPath =
    embedBatchSize > 1 &&
    typeof provider.embedBatch === 'function' &&
    !router &&
    chunkerStrategy === 'file'

  if (useBatchPath) {
    for (let batchStart = 0; batchStart < blobsToProcess.length; batchStart += embedBatchSize) {
      const batch = blobsToProcess.slice(batchStart, batchStart + embedBatchSize)

      // Read all blob contents in this batch in parallel
      const contentResults = await Promise.all(
        batch.map(async (entry) => {
          try {
            const content = await showBlob(entry.blobHash, repoPath, maxBlobSize)
            return { entry, content, error: null as Error | null }
          } catch (err) {
            return { entry, content: null, error: err as Error | null }
          }
        }),
      )

      // Partition into readable vs failed/oversized
      const readable: Array<{ entry: typeof blobsToProcess[0]; content: Buffer }> = []
      for (const r of contentResults) {
        if (r.error) {
          logger.error(`Error reading blob ${r.entry.blobHash}: ${r.error instanceof Error ? r.error.message : String(r.error)}`)
          stats.failed++
          stats.otherFailed++
        } else if (r.content === null) {
          stats.oversized++
        } else {
          readable.push({ entry: r.entry, content: r.content })
        }
      }

      if (readable.length === 0) {
        reportProgress()
        continue
      }

      // Batch-embed all readable blobs in a single provider call
      const texts = readable.map((r) => r.content.toString('utf8'))
      let embeddings: Array<Embedding | null>
      const batchT0 = Date.now()
      try {
        embeddings = await provider.embedBatch!(texts)
        const latPerItem = Math.max(1, Math.round((Date.now() - batchT0) / readable.length))
        for (let i = 0; i < readable.length; i++) pushLatency(latPerItem)
      } catch (batchErr) {
        // Batch failed — fall back to individual embeds for this batch
        logger.debug?.(`Batch embed failed (size=${readable.length}), falling back to per-blob: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`)
        embeddings = await Promise.all(
          texts.map(async (text) => {
            try {
              return await timedEmbed(provider, text)
            } catch {
              return null
            }
          }),
        )
      }

      // Store results
      for (let i = 0; i < readable.length; i++) {
        const { entry, content } = readable[i]
        const embedding = embeddings[i]
        const text = content.toString('utf8')

        if (!embedding) {
          stats.failed++
          stats.embedFailed++
          reportProgress()
          continue
        }

        const fileType = getFileCategory(entry.path)
        try {
          storeBlob({ blobHash: entry.blobHash, size: content.length, path: entry.path, model: provider.model, embedding, fileType, content: text, quantize })
          stats.indexed++
        } catch (err) {
          logger.error(`Failed to store blob ${entry.blobHash}: ${err instanceof Error ? err.message : String(err)}`)
          stats.failed++
          stats.otherFailed++
          reportProgress()
          continue
        }

        // Update module centroid running mean
        if (computeModuleEmbedding) {
          try {
            const dir = dirname(entry.path)
            const existing = getModuleEmbedding(dir, provider.model)
            if (existing === null) {
              storeModuleEmbedding({ modulePath: dir, model: provider.model, embedding, blobCount: 1 })
            } else {
              const newCount = existing.blobCount + 1
              const newVec = existing.vector.map((v, j) => (v * existing.blobCount + (embedding as number[])[j]) / newCount)
              storeModuleEmbedding({ modulePath: dir, model: provider.model, embedding: newVec, blobCount: newCount })
            }
            stats.moduleEmbeddings++
          } catch (err) {
            logger.debug?.(`Failed to update module embedding for ${entry.path}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        reportProgress()
      }
    }
  } else {
  // Note: stats mutations (stats.failed++, etc.) are safe here because Node.js
  // is single-threaded — each increment runs between await points and cannot
  // interleave with another increment on the same variable.
  await Promise.all(
    blobsToProcess.map((entry) =>
      limit(async () => {
        const { blobHash, path } = entry

            // Read content (returns null if over size cap)
            let content: Buffer | null
            try {
              content = await showBlob(blobHash, repoPath, maxBlobSize)
            } catch (err) {
              logger.error(`Error reading blob ${blobHash}: ${err instanceof Error ? err.message : String(err)}`)
              stats.failed++
              stats.otherFailed++
              reportProgress()
              return
            }

        if (content === null) {
          stats.oversized++
          reportProgress()
          return
        }

        // Determine file category and select the right provider
        const fileType = getFileCategory(path)
        const activeProvider = router ? router.providerForFile(path) : provider
        const text = content.toString('utf8')

        if (useChunking) {
          // Chunked indexing: always produce a Level-1 whole-file embedding first
          // (so search/evolution/clustering work), then additionally store per-chunk
          // embeddings in chunk_embeddings / symbol_embeddings.
          const blobChunks = chunker.chunk(text, path)
          let allOk = true

          // Level-1: attempt to embed the whole file. If successful, persist via
          // storeBlob (writes blob + embedding + path + FTS5 in one call). If the
          // embedding fails, fall back to storeBlobRecord (blob + path, no embedding).
          let wholeEmbedding: Embedding | null = null
          if (computeModuleEmbedding) {
            try {
              wholeEmbedding = await timedEmbed(activeProvider, text)
            } catch (err) {
              logger.debug?.(`Whole-file embedding failed for ${blobHash} (chunker=${chunkerStrategy}): ${err instanceof Error ? err.message : String(err)}`)
            }
          }

          try {
            if (wholeEmbedding !== null) {
              storeBlob({ blobHash, size: content.length, path, model: activeProvider.model, embedding: wholeEmbedding, fileType, content: text, quantize })
            } else {
              storeBlobRecord({ blobHash, size: content.length, path, content: text })
            }
          } catch (err) {
            logger.error(`Failed to store blob record ${blobHash}: ${err instanceof Error ? err.message : String(err)}`)
            stats.failed++
            stats.otherFailed++
            reportProgress()
            return
          }

          // Update module centroid running mean when Level-1 embedding was produced.
          if (wholeEmbedding !== null) {
            try {
              const dir = dirname(path)
              const existing = getModuleEmbedding(dir, activeProvider.model)
              if (existing === null) {
                storeModuleEmbedding({ modulePath: dir, model: activeProvider.model, embedding: wholeEmbedding, blobCount: 1 })
              } else {
                const newCount = existing.blobCount + 1
                const newVec = existing.vector.map((v, i) => (v * existing.blobCount + wholeEmbedding![i]) / newCount)
                storeModuleEmbedding({ modulePath: dir, model: activeProvider.model, embedding: newVec, blobCount: newCount })
              }
              stats.moduleEmbeddings++
            } catch (err) {
              logger.debug?.(`Failed to update module embedding for ${path}: ${err instanceof Error ? err.message : String(err)}`)
            }
          }

          for (const chunk of blobChunks) {
            let chunkEmbedding: Embedding
            try {
              chunkEmbedding = await timedEmbed(activeProvider, chunk.content)
            } catch (err) {
              logger.debug?.(`Embedding failed for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${err instanceof Error ? err.message : String(err)}`)
              allOk = false
              stats.failed++
              stats.embedFailed++
              onProgress?.({ ...stats, elapsed: Date.now() - start })
              continue
            }

            let chunkId: number | undefined
            try {
              chunkId = storeChunk({ blobHash, startLine: chunk.startLine, endLine: chunk.endLine, model: activeProvider.model, embedding: chunkEmbedding, quantize })
              stats.chunks++
            } catch (err) {
              logger.error(`Failed to store chunk for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${err instanceof Error ? err.message : String(err)}`)
              allOk = false
              stats.failed++
              stats.otherFailed++
            }

            // When using the function chunker AND the chunk carries a symbol name,
            // also embed the enriched text and store in symbols/symbol_embeddings.
            if (useSymbols && chunk.symbolName) {
              const lang = detectLanguageForPath(path)
              const enriched = buildEnrichedText(
                path, chunk.startLine, chunk.endLine,
                chunk.symbolKind ?? 'function', chunk.symbolName, chunk.content,
              )
              let symbolEmbedding: Embedding
              try {
                symbolEmbedding = await timedEmbed(activeProvider, enriched)
              } catch (err) {
                logger.debug?.(`Symbol embedding failed for ${path} ${chunk.symbolName}: ${err instanceof Error ? err.message : String(err)}`)
                // Symbol embedding failure is non-fatal — the chunk embedding succeeded
                reportProgress()
                continue
              }
              try {
                storeSymbol({
                  blobHash, startLine: chunk.startLine, endLine: chunk.endLine,
                  symbolName: chunk.symbolName, symbolKind: chunk.symbolKind ?? 'function',
                  language: lang, model: activeProvider.model, embedding: symbolEmbedding, chunkId,
                  quantize,
                })
                stats.symbols++
              } catch (err) {
                logger.error(`Failed to store symbol ${path} ${chunk.symbolName}: ${err instanceof Error ? err.message : String(err)}`)
                // Non-fatal: symbol storage failure does not roll back the chunk embedding
              }
            }
          }

          if (allOk) stats.indexed++
        } else {
          // Whole-file indexing (default, backward-compatible)
          let embedding: Embedding
          try {
            embedding = await timedEmbed(activeProvider, text)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.debug?.(`Embedding failed for blob ${blobHash}: ${msg}`)

            // If the failure looks like a context-length / input-too-large error,
            // attempt a fallback using the `function` chunker so we embed smaller
            // logical units and store per-chunk embeddings.
            if (typeof msg === 'string' && /context|input length|exceeds the context/i.test(msg)) {
              // record a function-chunker fallback attempt; detailed messages go to debug only
              stats.fbFunction++
              logger?.debug?.(`Attempting function-chunker fallback for blob ${blobHash}`)

              // Create a function chunker and split the file into chunks
              const fallbackChunker = createChunker('function', {})
              const blobChunks = fallbackChunker.chunk(text, path)
              let allOk = true

              try {
                storeBlobRecord({ blobHash, size: content.length, path, content: text })
              } catch (err2) {
                logger.error(`Failed to store blob record (fallback) ${blobHash}: ${err2 instanceof Error ? err2.message : String(err2)}`)
                stats.failed++
                stats.otherFailed++
                reportProgress()
                return
              }

              for (const chunk of blobChunks) {
                let chunkEmbedding: Embedding
                try {
                  chunkEmbedding = await timedEmbed(activeProvider, chunk.content)
                } catch (err3) {
                  const msg3 = err3 instanceof Error ? err3.message : String(err3)
                  logger.debug?.(`Embedding failed for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${msg3}`)

                  // If chunk still exceeds context, try fixed-size windows progressively
                  if (typeof msg3 === 'string' && /context|input length|exceeds the context/i.test(msg3)) {
                    const fixedSizes = [1500, 800]
                    let fixedSucceeded = false

                    for (const size of fixedSizes) {
                      // record a fixed-window fallback attempt (per-window); verbose only
                      stats.fbFixed++
                      logger?.debug?.(`Attempting fixed-chunker (window=${size}) fallback for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}`)
                      const fixedChunker = createChunker('fixed', { windowSize: size, overlap: 200 })
                      const subChunks = fixedChunker.chunk(chunk.content, path)
                      let subAllOk = true

                      for (const sub of subChunks) {
                        let subEmb: Embedding | null = null
                        try {
                          subEmb = await timedEmbed(activeProvider, sub.content)
                        } catch (err5) {
                          const msg5 = err5 instanceof Error ? err5.message : String(err5)
                          logger.debug?.(`Embedding failed for blob ${blobHash} subchunk ${chunk.startLine + sub.startLine - 1}-${chunk.startLine + sub.endLine - 1}: ${msg5}`)
                          subAllOk = false
                          stats.failed++
                          stats.embedFailed++
                          onProgress?.({ ...stats, elapsed: Date.now() - start })
                          // continue attempting other subchunks to collect failures
                          continue
                        }

                        try {
                          const absStart = chunk.startLine + sub.startLine - 1
                          const absEnd = chunk.startLine + sub.endLine - 1
                          storeChunk({ blobHash, startLine: absStart, endLine: absEnd, model: activeProvider.model, embedding: subEmb!, quantize })
                          stats.chunks++
                        } catch (err6) {
                          logger.error(`Failed to store subchunk for blob ${blobHash} subchunk ${chunk.startLine + sub.startLine - 1}-${chunk.startLine + sub.endLine - 1}: ${err6 instanceof Error ? err6.message : String(err6)}`)
                          subAllOk = false
                          stats.failed++
                          stats.otherFailed++
                        }
                      }

                      if (subAllOk) {
                        fixedSucceeded = true
                        break
                      }
                      // otherwise try next smaller window
                    }

                    if (fixedSucceeded) {
                      // this chunk recovered via fixed-chunker
                      continue
                    }
                  }

                  // If we reach here, fallback failed or error wasn't context-related
                  allOk = false
                  stats.failed++
                  stats.embedFailed++
                  onProgress?.({ ...stats, elapsed: Date.now() - start })
                  continue
                }

                try {
                  storeChunk({ blobHash, startLine: chunk.startLine, endLine: chunk.endLine, model: activeProvider.model, embedding: chunkEmbedding, quantize })
                  stats.chunks++
                } catch (err4) {
                  logger.error(`Failed to store chunk (fallback) for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${err4 instanceof Error ? err4.message : String(err4)}`)
                  allOk = false
                  stats.failed++
                  stats.otherFailed++
                }
              }

              if (allOk) stats.indexed++
              else stats.failed++

              onProgress?.({ ...stats, elapsed: Date.now() - start })
              return
            }

            // Non-recoverable embedding failure
            stats.failed++
            stats.embedFailed++
            onProgress?.({ ...stats, elapsed: Date.now() - start })
            return
          }

          // Persist blob + embedding + path in one transaction
          try {
            storeBlob({ blobHash, size: content.length, path, model: activeProvider.model, embedding, fileType, content: text, quantize })
            stats.indexed++
          } catch (err) {
            logger.error(`Failed to store blob ${blobHash}: ${err instanceof Error ? err.message : String(err)}`)
            stats.failed++
            stats.otherFailed++
            onProgress?.({ ...stats, elapsed: Date.now() - start })
            return
          }

          // Update module centroid running mean for whole-file mode.
          if (computeModuleEmbedding) {
            try {
              const dir = dirname(path)
              const existing = getModuleEmbedding(dir, activeProvider.model)
              if (existing === null) {
                storeModuleEmbedding({ modulePath: dir, model: activeProvider.model, embedding, blobCount: 1 })
              } else {
                const newCount = existing.blobCount + 1
                const newVec = existing.vector.map((v, i) => (v * existing.blobCount + embedding[i]) / newCount)
                storeModuleEmbedding({ modulePath: dir, model: activeProvider.model, embedding: newVec, blobCount: newCount })
              }
              stats.moduleEmbeddings++
            } catch (err) {
              logger.debug?.(`Failed to update module embedding for ${path}: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
        }

        onProgress?.({ ...stats, elapsed: Date.now() - start })
      }),
    ),
  )
  } // end else (per-blob path)

  // finalize embedding timing and transition to commit mapping
  stats.stageTimings.embedding = Date.now() - embeddingStart
  stats.currentStage = 'commit-mapping'
  const commitMappingStart = Date.now()

  // Phase B: Walk commit history, persist to commits/blobCommits
  const commitStream = streamCommitMap(repoPath, { maxCommits, branch: branchFilter }) as AsyncIterable<CommitMapEvent>

  let pendingCommit: CommitEntry | null = null
  let pendingBlobHashes: string[] = []

  async function flushPendingCommit(): Promise<void> {
    if (!pendingCommit) return
    const stored = storeCommitWithBlobs(pendingCommit, pendingBlobHashes)
    stats.commits++
    stats.blobCommits += stored

    // Write branch associations for every blob introduced by this commit
    if (pendingCommit.branches.length > 0) {
      for (const blobHash of pendingBlobHashes) {
        storeBlobBranches(blobHash, pendingCommit.branches)
      }
    }

    // Embed the commit message using the text provider (natural-language prose).
    // Failures are non-fatal: we log and count them, then move on.
    if (pendingCommit.message.trim().length > 0) {
      try {
        const msgEmbedding = await timedEmbed(provider, pendingCommit.message)
        storeCommitEmbedding({
          commitHash: pendingCommit.commitHash,
          model: provider.model,
          embedding: msgEmbedding,
          quantize,
        })
        stats.commitEmbeddings++
      } catch (err) {
        logger.debug?.(`Failed to embed commit message ${pendingCommit.commitHash}: ${err instanceof Error ? err.message : String(err)}`)
        stats.commitEmbedFailed++
      }
    }

    // Record commit as fully indexed for future incremental runs
    markCommitIndexed(pendingCommit.commitHash)

    pendingCommit = null
    pendingBlobHashes = []
  }

  for await (const event of commitStream) {
    if (event.type === 'commit') {
      await flushPendingCommit()
      pendingCommit = event.data
      pendingBlobHashes = []
    } else if (event.type === 'blob') {
      pendingBlobHashes.push(event.data.blobHash)
    }
    onProgress?.({ ...stats, elapsed: Date.now() - start })
  }

  await flushPendingCommit()

  // finalize commit mapping timing
  stats.stageTimings.commitMapping = Date.now() - commitMappingStart
  stats.currentStage = 'done'

  // Ensure latency stats are finalized for the summary
  computeLatencyStats()

  stats.elapsed = Date.now() - start
  return stats
}
