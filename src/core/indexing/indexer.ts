import { revList, type BlobEntry } from '../git/revList.js'
import { showBlob, DEFAULT_MAX_SIZE } from '../git/showBlob.js'
import { streamCommitMap, type CommitEntry, type CommitMapEvent } from '../git/commitMap.js'
import { isIndexed } from './deduper.js'
import { storeBlob, storeCommitWithBlobs, markCommitIndexed, getLastIndexedCommit } from './blobStore.js'
import type { EmbeddingProvider } from '../embedding/provider.js'
import { RoutingProvider } from '../embedding/router.js'
import { getFileCategory } from '../embedding/fileType.js'
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
  /** Path-based filter applied before any blob content is read. */
  filter?: FilterOptions
  onProgress?: (stats: IndexStats) => void
}

export interface IndexStats {
  seen: number
  indexed: number
  skipped: number   // already in DB
  oversized: number // over size limit
  filtered: number  // excluded by path filter
  failed: number
  elapsed: number   // ms
  commits: number       // Phase 6: commits stored
  blobCommits: number   // Phase 6: blob-commit links stored
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
    filter = {},
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

  // Concurrency limiter for embedding calls
  const limit = createLimiter(concurrency)

  const stats: IndexStats = {
    seen: 0, indexed: 0, skipped: 0, oversized: 0, filtered: 0, failed: 0,
    elapsed: 0, commits: 0, blobCommits: 0,
  }
  const start = Date.now()
  const seenHashes = new Set<string>()

  const stream = revList(repoPath, { since })

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
        } catch {
          stats.failed++
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

        // Generate embedding
        let embedding: number[]
        try {
          embedding = await activeProvider.embed(content.toString('utf8'))
        } catch {
          stats.failed++
          onProgress?.({ ...stats, elapsed: Date.now() - start })
          return
        }

        // Persist blob + embedding + path in one transaction
        try {
          storeBlob({ blobHash, size: content.length, path, model: activeProvider.model, embedding, fileType })
          stats.indexed++
        } catch {
          stats.failed++
        }

        onProgress?.({ ...stats, elapsed: Date.now() - start })
      }),
    ),
  )

  // Phase B: Walk commit history, persist to commits/blobCommits
  const commitStream = streamCommitMap(repoPath) as AsyncIterable<CommitMapEvent>

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
