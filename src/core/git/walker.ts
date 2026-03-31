import { revList, type BlobEntry } from './revList.js'
import { showBlob, DEFAULT_MAX_SIZE } from './showBlob.js'

export interface WalkerBlob {
  blobHash: string
  path: string
  content: Buffer
  size: number
}

export interface WalkerStats {
  seen: number
  skipped: number   // over size limit
  totalBytes: number
}

export interface WalkerOptions {
  repoPath?: string
  maxBlobSize?: number
  onBlob?: (blob: WalkerBlob) => void | Promise<void>
  onStats?: (stats: WalkerStats) => void
}

/**
 * Walks all blobs in the repo. Deduplicates by blobHash so each unique blob
 * is yielded exactly once regardless of how many commits it appears in.
 *
 * Calls options.onBlob for each unique blob under the size cap.
 * Returns final stats when done.
 */
export async function walk(options: WalkerOptions = {}): Promise<WalkerStats> {
  const {
    repoPath = '.',
    maxBlobSize = DEFAULT_MAX_SIZE,
    onBlob,
    onStats,
  } = options

  const seen = new Set<string>()
  const stats: WalkerStats = { seen: 0, skipped: 0, totalBytes: 0 }

  const stream = revList(repoPath)

  for await (const entry of stream as AsyncIterable<BlobEntry>) {
    const { blobHash, path } = entry
    if (seen.has(blobHash)) continue
    seen.add(blobHash)
    stats.seen++

    const content = await showBlob(blobHash, repoPath, maxBlobSize)
    if (content === null) {
      stats.skipped++
      continue
    }

    stats.totalBytes += content.length

    if (onBlob) {
      await onBlob({ blobHash, path, content, size: content.length })
    }
  }

  onStats?.(stats)
  return stats
}
