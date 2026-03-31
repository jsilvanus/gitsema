import { revList, type BlobEntry } from '../git/revList.js'
import { showBlob, DEFAULT_MAX_SIZE } from '../git/showBlob.js'
import { streamCommitMap, type CommitEntry, type CommitMapEvent } from '../git/commitMap.js'
import { isIndexed } from './deduper.js'
import { storeBlob, storeBlobRecord, storeChunk, storeCommitWithBlobs, markCommitIndexed, getLastIndexedCommit } from './blobStore.js'
import type { EmbeddingProvider } from '../embedding/provider.js'
import { RoutingProvider } from '../embedding/router.js'
import { getFileCategory } from '../embedding/fileType.js'
import { createChunker, type ChunkStrategy, type ChunkOptions } from '../chunking/chunker.js'
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
  /**
   * Total blobs queued for embedding (set after the collection phase).
   * Zero until collection is complete. Used by the CLI to render a progress bar.
   */
  queued: number
  elapsed: number   // ms
  commits: number       // Phase 6: commits stored
  blobCommits: number   // Phase 6: blob-commit links stored
  chunks: number        // Phase 10: chunk embeddings stored
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

  // Concurrency limiter for embedding calls
  const limit = createLimiter(concurrency)

  const stats: IndexStats = {
    seen: 0, indexed: 0, skipped: 0, oversized: 0, filtered: 0, failed: 0,
    embedFailed: 0, otherFailed: 0,
    queued: 0, elapsed: 0, commits: 0, blobCommits: 0, chunks: 0,
  }
  const start = Date.now()
  const seenHashes = new Set<string>()

  const stream = revList(repoPath, { since, maxCommits })

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
              console.error(`Error reading blob ${blobHash}: ${err instanceof Error ? err.message : String(err)}`)
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
            console.error(`Failed to store blob record ${blobHash}: ${err instanceof Error ? err.message : String(err)}`)
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
              console.error(`Embedding failed for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${err instanceof Error ? err.message : String(err)}`)
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
              console.error(`Failed to store chunk for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${err instanceof Error ? err.message : String(err)}`)
              allOk = false
              stats.failed++
              stats.otherFailed++
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
            console.error(`Embedding failed for blob ${blobHash}: ${msg}`)

            // If the failure looks like a context-length / input-too-large error,
            // attempt a fallback using the `function` chunker so we embed smaller
            // logical units and store per-chunk embeddings.
            if (typeof msg === 'string' && /context|input length|exceeds the context/i.test(msg)) {
              console.error(`Attempting function-chunker fallback for blob ${blobHash}`)

              // Create a function chunker and split the file into chunks
              const fallbackChunker = createChunker('function', {})
              const blobChunks = fallbackChunker.chunk(text, path)
              let allOk = true

              try {
                storeBlobRecord({ blobHash, size: content.length, path, content: text })
              } catch (err2) {
                console.error(`Failed to store blob record (fallback) ${blobHash}: ${err2 instanceof Error ? err2.message : String(err2)}`)
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
                  console.error(`Embedding failed for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${msg3}`)

                  // If chunk still exceeds context, try fixed-size windows progressively
                  if (typeof msg3 === 'string' && /context|input length|exceeds the context/i.test(msg3)) {
                    const fixedSizes = [1500, 800]
                    let fixedSucceeded = false

                    for (const size of fixedSizes) {
                      console.error(`Attempting fixed-chunker (window=${size}) fallback for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}`)
                      const fixedChunker = createChunker('fixed', { windowSize: size, overlap: 200 })
                      const subChunks = fixedChunker.chunk(chunk.content, path)
                      let subAllOk = true

                      for (const sub of subChunks) {
                        let subEmb: number[] | null = null
                        try {
                          subEmb = await activeProvider.embed(sub.content)
                        } catch (err5) {
                          const msg5 = err5 instanceof Error ? err5.message : String(err5)
                          console.error(`Embedding failed for blob ${blobHash} subchunk ${chunk.startLine + sub.startLine - 1}-${chunk.startLine + sub.endLine - 1}: ${msg5}`)
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
                          console.error(`Failed to store subchunk for blob ${blobHash} subchunk ${chunk.startLine + sub.startLine - 1}-${chunk.startLine + sub.endLine - 1}: ${err6 instanceof Error ? err6.message : String(err6)}`)
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
                  console.error(`Failed to store chunk (fallback) for blob ${blobHash} chunk ${chunk.startLine}-${chunk.endLine}: ${err4 instanceof Error ? err4.message : String(err4)}`)
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
            console.error(`Failed to store blob ${blobHash}: ${err instanceof Error ? err.message : String(err)}`)
            stats.failed++
            stats.otherFailed++
          }
        }

        onProgress?.({ ...stats, elapsed: Date.now() - start })
      }),
    ),
  )

  // Phase B: Walk commit history, persist to commits/blobCommits
  const commitStream = streamCommitMap(repoPath, { maxCommits }) as AsyncIterable<CommitMapEvent>

  let pendingCommit: CommitEntry | null = null
  let pendingBlobHashes: string[] = []

  function flushPendingCommit(): void {
    if (!pendingCommit) return
    const stored = storeCommitWithBlobs(pendingCommit, pendingBlobHashes)
    stats.commits++
    stats.blobCommits += stored

    // Record commit as fully indexed for future incremental runs
    markCommitIndexed(pendingCommit.commitHash)

    pendingCommit = null
    pendingBlobHashes = []
  }

  for await (const event of commitStream) {
    if (event.type === 'commit') {
      flushPendingCommit()
      pendingCommit = event.data
      pendingBlobHashes = []
    } else if (event.type === 'blob') {
      pendingBlobHashes.push(event.data.blobHash)
    }
    onProgress?.({ ...stats, elapsed: Date.now() - start })
  }

  flushPendingCommit()

  stats.elapsed = Date.now() - start
  return stats
}
