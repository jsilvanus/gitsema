/**
 * Remote indexer (Phase 15).
 *
 * Mirrors runIndex() from indexer.ts but routes all embedding and storage to
 * the gitsema HTTP server instead of running locally.  Only git operations
 * (revList, showBlob, streamCommitMap) run on the client.
 *
 * Pipeline:
 *   revList → batch-check with server → showBlob for missing → uploadBlobs
 *   streamCommitMap → uploadCommits + markCommitIndexed
 */

import { revList, type BlobEntry } from '../git/revList.js'
import { showBlob, DEFAULT_MAX_SIZE } from '../git/showBlob.js'
import { streamCommitMap, type CommitMapEvent } from '../git/commitMap.js'
import { getFileCategory } from '../embedding/fileType.js'
import { createLimiter } from '../../utils/concurrency.js'
import { logger } from '../../utils/logger.js'
import {
  checkBlobs,
  uploadBlobs,
  uploadCommits,
  markCommitIndexed,
  type RemoteBlobPayload,
  type RemoteCommitPayload,
} from '../../client/remoteClient.js'
import type { FilterOptions, IndexStats } from './indexer.js'

export interface RemoteIndexerOptions {
  repoPath?: string
  maxBlobSize?: number
  since?: string
  concurrency?: number
  maxCommits?: number
  filter?: FilterOptions
  onProgress?: (stats: IndexStats) => void
}

function isFiltered(path: string, filter: FilterOptions): boolean {
  if (filter.ext && filter.ext.length > 0) {
    const dot = path.lastIndexOf('.')
    const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
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
 * Runs the remote indexing pipeline:
 *   1. Walk git history with revList
 *   2. Ask the server which blobs it already has (batch dedup check)
 *   3. Fetch content for missing blobs via showBlob
 *   4. Upload blob payloads to the server in batches
 *   5. Walk commit metadata and upload to the server
 */
export async function runRemoteIndex(options: RemoteIndexerOptions): Promise<IndexStats> {
  const {
    repoPath = '.',
    maxBlobSize = DEFAULT_MAX_SIZE,
    since,
    concurrency = 4,
    maxCommits,
    filter = {},
    onProgress,
  } = options

  const stats: IndexStats = {
    seen: 0, indexed: 0, skipped: 0, oversized: 0, filtered: 0,
    failed: 0, embedFailed: 0, otherFailed: 0,
    fbFunction: 0, fbFixed: 0,
    queued: 0, elapsed: 0, commits: 0, blobCommits: 0, chunks: 0,
    symbols: 0, moduleEmbeddings: 0, commitEmbeddings: 0, commitEmbedFailed: 0,
    currentStage: 'collecting',
    stageTimings: { collection: 0, embedding: 0, commitMapping: 0 },
    embedLatencyAvgMs: 0,
    embedLatencyP95Ms: 0,
  }
  const start = Date.now()
  const seenHashes = new Set<string>()

  // -------------------------------------------------------------------------
  // Phase A: Collect blob entries from git history
  // -------------------------------------------------------------------------
  const stream = revList(repoPath, { since: since === 'all' ? undefined : since, maxCommits })
  const blobsToProcess: BlobEntry[] = []

  for await (const entry of stream as AsyncIterable<BlobEntry>) {
    const { blobHash, path } = entry

    if (seenHashes.has(blobHash)) continue
    seenHashes.add(blobHash)
    stats.seen++

    if (isFiltered(path, filter)) {
      stats.filtered++
      onProgress?.({ ...stats, elapsed: Date.now() - start })
      continue
    }

    blobsToProcess.push(entry)
  }

  // Ask server which blobs are missing (server-side dedup check)
  const allHashes = blobsToProcess.map((e) => e.blobHash)
  let missingSet: Set<string>
  try {
    missingSet = await checkBlobs(allHashes)
  } catch (err) {
    throw new Error(`Failed to check blobs with server: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Partition: already indexed vs needs uploading
  const toUpload = blobsToProcess.filter((e) => missingSet.has(e.blobHash))
  stats.skipped = blobsToProcess.length - toUpload.length
  stats.queued = toUpload.length
  onProgress?.({ ...stats, elapsed: Date.now() - start })

  // -------------------------------------------------------------------------
  // Phase B: Fetch content and upload blobs in batches
  // -------------------------------------------------------------------------
  const UPLOAD_BATCH = 50
  const limit = createLimiter(concurrency)

  // Collect ready payloads; upload in fixed-size batches
  const pendingPayloads: RemoteBlobPayload[] = []

  async function flushBatch(): Promise<void> {
    if (pendingPayloads.length === 0) return
    const batch = pendingPayloads.splice(0, pendingPayloads.length)
    try {
      const result = await uploadBlobs(batch)
      stats.indexed += result.indexed
      stats.skipped += result.skipped
      stats.failed += result.failed
    } catch (err) {
      logger.error(`Upload batch failed: ${err instanceof Error ? err.message : String(err)}`)
      stats.failed += batch.length
    }
    onProgress?.({ ...stats, elapsed: Date.now() - start })
  }

  await Promise.all(
    toUpload.map((entry) =>
      limit(async () => {
        const { blobHash, path } = entry

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

        const text = content.toString('utf8')
        const fileType = getFileCategory(path)

        pendingPayloads.push({ blobHash, path, size: content.length, content: text, fileType })

        if (pendingPayloads.length >= UPLOAD_BATCH) {
          await flushBatch()
        }
      }),
    ),
  )

  // Upload any remaining blobs
  await flushBatch()

  // -------------------------------------------------------------------------
  // Phase C: Commit metadata
  // -------------------------------------------------------------------------
  const commitStream = streamCommitMap(repoPath, { maxCommits })
  const pendingCommits: RemoteCommitPayload[] = []
  let currentCommitBlobs: string[] = []
  let currentCommitHash = ''

  for await (const event of commitStream as AsyncIterable<CommitMapEvent>) {
    if (event.type === 'commit') {
      if (currentCommitHash && currentCommitBlobs.length > 0) {
        pendingCommits.push({
          commitHash: currentCommitHash,
          timestamp: 0, // will be set below — we carry the commit entry forward
          message: '',
          blobHashes: currentCommitBlobs,
        })
      }
      currentCommitHash = event.data.commitHash
      currentCommitBlobs = []

      // Store commit directly with its metadata
      pendingCommits.push({
        commitHash: event.data.commitHash,
        timestamp: event.data.timestamp,
        message: event.data.message,
        blobHashes: [],
      })
    } else if (event.type === 'blob') {
      // Attach blob to the most recent commit entry
      const last = pendingCommits[pendingCommits.length - 1]
      if (last && last.commitHash === event.data.commitHash) {
        last.blobHashes.push(event.data.blobHash)
      }
    }
  }

  if (pendingCommits.length > 0) {
    try {
      const stored = await uploadCommits(pendingCommits)
      stats.commits = pendingCommits.length
      stats.blobCommits = stored
    } catch (err) {
      logger.error(`Commit upload failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    onProgress?.({ ...stats, elapsed: Date.now() - start })
  }

  // Mark the most recently traversed commit as indexed for incremental resume
  if (currentCommitHash) {
    try {
      await markCommitIndexed(currentCommitHash)
    } catch (err) {
      logger.error(`Failed to mark commit indexed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  stats.elapsed = Date.now() - start
  return stats
}
