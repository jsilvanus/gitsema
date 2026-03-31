import { db } from '../db/sqlite.js'
import { blobs, embeddings, paths, commits, blobCommits } from '../db/schema.js'
import { inArray } from 'drizzle-orm'
import type { BlobHash, Embedding } from '../models/types.js'
import type { FileCategory } from '../embedding/fileType.js'
import type { CommitEntry } from '../git/commitMap.js'

export interface StoreBlobArgs {
  blobHash: BlobHash
  size: number
  path: string
  model: string
  embedding: Embedding
  fileType?: FileCategory
}

/**
 * Writes a blob, its embedding, and its path in a single transaction.
 * Safe to call multiple times for the same blobHash with different paths
 * (the blob/embedding rows are skipped via INSERT OR IGNORE; a new path row is added).
 */
export function storeBlob(args: StoreBlobArgs): void {
  const { blobHash, size, path, model, embedding, fileType } = args

  // Serialize float32 embedding to a Buffer
  const vector = Buffer.from(new Float32Array(embedding).buffer)

  db.transaction((tx) => {
    tx.insert(blobs)
      .values({ blobHash, size, indexedAt: Date.now() })
      .onConflictDoNothing()
      .run()

    tx.insert(embeddings)
      .values({ blobHash, model, dimensions: embedding.length, vector, fileType: fileType ?? null })
      .onConflictDoNothing()
      .run()

    tx.insert(paths)
      .values({ blobHash, path })
      .run()
  })
}

/**
 * Stores a commit and its associated blob-commit links in a single transaction.
 * Only creates blobCommit rows for blobs that are already indexed in the blobs table.
 * Returns the number of blobCommit rows stored.
 */
export function storeCommitWithBlobs(commit: CommitEntry, blobHashes: string[]): number {
  if (blobHashes.length === 0) {
    db.insert(commits)
      .values({ commitHash: commit.commitHash, timestamp: commit.timestamp, message: commit.message })
      .onConflictDoNothing()
      .run()
    return 0
  }

  // Deduplicate input hashes
  const uniqueHashes = [...new Set(blobHashes)]

  // Pre-filter: find which hashes are already indexed using a single IN query
  const BATCH = 500
  const indexedSet = new Set<string>()
  for (let i = 0; i < uniqueHashes.length; i += BATCH) {
    const batch = uniqueHashes.slice(i, i + BATCH)
    const rows = db.select({ blobHash: blobs.blobHash })
      .from(blobs)
      .where(inArray(blobs.blobHash, batch))
      .all()
    for (const row of rows) indexedSet.add(row.blobHash)
  }

  const indexedHashes = uniqueHashes.filter((h) => indexedSet.has(h))

  db.transaction((tx) => {
    tx.insert(commits)
      .values({ commitHash: commit.commitHash, timestamp: commit.timestamp, message: commit.message })
      .onConflictDoNothing()
      .run()

    for (const blobHash of indexedHashes) {
      tx.insert(blobCommits)
        .values({ blobHash, commitHash: commit.commitHash })
        .onConflictDoNothing()
        .run()
    }
  })

  return indexedHashes.length
}
