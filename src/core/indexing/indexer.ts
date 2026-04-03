import { revList, type BlobEntry } from '../git/revList.js'
import { showBlob, DEFAULT_MAX_SIZE } from '../git/showBlob.js'
import { streamCommitMap, type CommitEntry, type CommitMapEvent } from '../git/commitMap.js'
import { isIndexed } from './deduper.js'
import { storeBlob, storeBlobRecord, storeChunk, storeSymbol, storeCommitWithBlobs, markCommitIndexed, getLastIndexedCommit, storeBlobBranches, storeCommitEmbedding } from './blobStore.js'
import type { EmbeddingProvider } from '../embedding/provider.js'
import { RoutingProvider } from '../embedding/router.js'
import { getFileCategory } from '../embedding/fileType.js'
import { createChunker, type ChunkStrategy, type ChunkOptions } from '../chunking/chunker.js'
import { logger } from '../../utils/logger.js'
import { createLimiter } from '../../utils/concurrency.js'
import { extname } from 'node:path'

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
  /** Number of commit message embeddings stored (Phase 28). */
  commitEmbeddings: number
  /** Number of commit message embedding failures (Phase 28). */
  commitEmbedFailed: number
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
    onProgress,
  } = options

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
    commitEmbeddings: 0, commitEmbedFailed: 0,
  }
  const start = Date.now()
  const seenHashes = new Set<string>()

  const stream = revList(repoPath, { since, maxCommits, branch: branchFilter })

  // Collect blobs first so we can fan-out embedding calls concurrently
  const blobsToProcess: BlobEntry[] = []

  for await (const entry of stream as AsyncIterable<BlobEntry>) {
    const { blobHash, path } = entry

    // Deduplicate within this run (same blob at multiple paths)
    if (seenHashes.has(blobHash)) continue
    seenHashes.add(blobHash)
    stats.seen++

    // Path-based filter (applied before any I/O)
    if (isFiltered(path, filter)) {
      stats.filtered++
      onProgress?.({ ...stats, elapsed: Date.now() - start })
      continue
    }

    // Skip blobs already in the database
    if (isIndexed(blobHash)) {
      stats.skipped++
      onProgress?.({ ...stats, elapsed: Date.now() - start })
      continue
    }

    blobsToProcess.push(entry)
  }

  // Expose the total work queue so callers can render a progress bar.
  stats.queued = blobsToProcess.length
  onProgress?.({ ...stats, elapsed: Date.now() - start })

  // Process blobs concurrently up to the configured limit.
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
              onProgress?.({ ...stats, elapsed: Date.now() - start })
              return
            }

        if (content === null) {
          stats.oversized++
          onProgress?.({ ...stats, elapsed: Date.now() - start })
          return
        }

        // Determine file category and select the right provider
        const fileType = getFileCategory(path)
        const activeProvider = router ? router.providerForFile(path) : provider
        const text = content.toString('utf8')

        if (useChunking) {
          // Chunked indexing: split into chunks and embed each separately.
          // Write the blob record and path once (no whole-file embedding),
          // then store per-chunk embeddings in the chunk_embeddings table.
          const blobChunks = chunker.chunk(text, path)
          let allOk = true

          // Persist the blob record and path row exactly once before embedding chunks.
          try {
            storeBlobRecord({ blobHash, size: content.length, path, content: text })
          } catch (err) {
            logger.error(`Failed to store blob record ${blobHash}: ${err instanceof Error ? err.message : String(err)}`)
            stats.failed++
            stats.otherFailed++
            onProgress?.({ ...stats, elapsed: Date.now() - start })
            return
          }

          for (const chunk of blobChunks) {
            let chunkEmbedding: number[]
            try {
              chunkEmbedding = await activeProvider.embed(chunk.content)
            } catch (err) {
              logger.debug?.(`Embedding failed for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${err instanceof Error ? err.message : String(err)}`)
              allOk = false
              stats.failed++
              stats.embedFailed++
              onProgress?.({ ...stats, elapsed: Date.now() - start })
              continue
            }

            try {
              storeChunk({ blobHash, startLine: chunk.startLine, endLine: chunk.endLine, model: activeProvider.model, embedding: chunkEmbedding })
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
              let symbolEmbedding: number[]
              try {
                symbolEmbedding = await activeProvider.embed(enriched)
              } catch (err) {
                logger.debug?.(`Symbol embedding failed for ${path} ${chunk.symbolName}: ${err instanceof Error ? err.message : String(err)}`)
                // Symbol embedding failure is non-fatal — the chunk embedding succeeded
                onProgress?.({ ...stats, elapsed: Date.now() - start })
                continue
              }
              try {
                storeSymbol({
                  blobHash, startLine: chunk.startLine, endLine: chunk.endLine,
                  symbolName: chunk.symbolName, symbolKind: chunk.symbolKind ?? 'function',
                  language: lang, model: activeProvider.model, embedding: symbolEmbedding,
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
          let embedding: number[]
          try {
            embedding = await activeProvider.embed(text)
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
                onProgress?.({ ...stats, elapsed: Date.now() - start })
                return
              }

              for (const chunk of blobChunks) {
                let chunkEmbedding: number[]
                try {
                  chunkEmbedding = await activeProvider.embed(chunk.content)
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
                        let subEmb: number[] | null = null
                        try {
                          subEmb = await activeProvider.embed(sub.content)
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
                          storeChunk({ blobHash, startLine: absStart, endLine: absEnd, model: activeProvider.model, embedding: subEmb })
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
                  storeChunk({ blobHash, startLine: chunk.startLine, endLine: chunk.endLine, model: activeProvider.model, embedding: chunkEmbedding })
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
            storeBlob({ blobHash, size: content.length, path, model: activeProvider.model, embedding, fileType, content: text })
            stats.indexed++
          } catch (err) {
            logger.error(`Failed to store blob ${blobHash}: ${err instanceof Error ? err.message : String(err)}`)
            stats.failed++
            stats.otherFailed++
          }
        }

        onProgress?.({ ...stats, elapsed: Date.now() - start })
      }),
    ),
  )

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
        const msgEmbedding = await provider.embed(pendingCommit.message)
        storeCommitEmbedding({
          commitHash: pendingCommit.commitHash,
          model: provider.model,
          embedding: msgEmbedding,
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

  stats.elapsed = Date.now() - start
  return stats
}
