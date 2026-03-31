import { revList, type BlobEntry } from '../git/revList.js'
import { showBlob, DEFAULT_MAX_SIZE } from '../git/showBlob.js'
import { streamCommitMap, type CommitEntry, type CommitMapEvent } from '../git/commitMap.js'
import { isIndexed } from './deduper.js'
import { storeBlob, storeCommitWithBlobs } from './blobStore.js'
import type { EmbeddingProvider } from '../embedding/provider.js'
import { RoutingProvider } from '../embedding/router.js'
import { getFileCategory } from '../embedding/fileType.js'

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
   */
  since?: string
  onProgress?: (stats: IndexStats) => void
}

export interface IndexStats {
  seen: number
  indexed: number
  skipped: number   // already in DB
  oversized: number // over size limit
  failed: number
  elapsed: number   // ms
  commits: number       // Phase 6: commits stored
  blobCommits: number   // Phase 6: blob-commit links stored
}

export async function runIndex(options: IndexerOptions): Promise<IndexStats> {
  const { repoPath = '.', maxBlobSize = DEFAULT_MAX_SIZE, provider, codeProvider, since, onProgress } = options

  // Build a routing provider when a separate code model is configured.
  const router = codeProvider ? new RoutingProvider(provider, codeProvider) : null

  const stats: IndexStats = { seen: 0, indexed: 0, skipped: 0, oversized: 0, failed: 0, elapsed: 0, commits: 0, blobCommits: 0 }
  const start = Date.now()
  const seenHashes = new Set<string>()

  const stream = revList(repoPath, { since })

  for await (const entry of stream as AsyncIterable<BlobEntry>) {
    const { blobHash, path } = entry

    // Deduplicate within this run (same blob at multiple paths)
    if (seenHashes.has(blobHash)) continue
    seenHashes.add(blobHash)
    stats.seen++

    // Skip blobs already in the database
    if (isIndexed(blobHash)) {
      stats.skipped++
      onProgress?.({ ...stats, elapsed: Date.now() - start })
      continue
    }

    // Read content (returns null if over size cap)
    let content: Buffer | null
    try {
      content = await showBlob(blobHash, repoPath, maxBlobSize)
    } catch {
      stats.failed++
      onProgress?.({ ...stats, elapsed: Date.now() - start })
      continue
    }

    if (content === null) {
      stats.oversized++
      onProgress?.({ ...stats, elapsed: Date.now() - start })
      continue
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
      continue
    }

    // Persist blob + embedding + path in one transaction
    try {
      storeBlob({ blobHash, size: content.length, path, model: activeProvider.model, embedding, fileType })
      stats.indexed++
    } catch {
      stats.failed++
    }

    onProgress?.({ ...stats, elapsed: Date.now() - start })
  }

  // Phase B: Walk commit history, persist to commits/blobCommits
  const commitStream = streamCommitMap(repoPath) as AsyncIterable<CommitMapEvent>

  let pendingCommit: CommitEntry | null = null
  let pendingBlobHashes: string[] = []

  function flushPendingCommit(): void {
    if (!pendingCommit) return
    const stored = storeCommitWithBlobs(pendingCommit, pendingBlobHashes)
    stats.commits++
    stats.blobCommits += stored
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
