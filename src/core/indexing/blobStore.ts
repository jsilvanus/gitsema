import { db } from '../db/sqlite.js'
import { blobs, embeddings, paths } from '../db/schema.js'
import type { BlobHash, Embedding } from '../models/types.js'

export interface StoreBlobArgs {
  blobHash: BlobHash
  size: number
  path: string
  model: string
  embedding: Embedding
}

/**
 * Writes a blob, its embedding, and its path in a single transaction.
 * Safe to call multiple times for the same blobHash with different paths
 * (the blob/embedding rows are skipped via INSERT OR IGNORE; a new path row is added).
 */
export function storeBlob(args: StoreBlobArgs): void {
  const { blobHash, size, path, model, embedding } = args

  // Serialize float32 embedding to a Buffer
  const vector = Buffer.from(new Float32Array(embedding).buffer)

  db.transaction((tx) => {
    tx.insert(blobs)
      .values({ blobHash, size, indexedAt: Date.now() })
      .onConflictDoNothing()
      .run()

    tx.insert(embeddings)
      .values({ blobHash, model, dimensions: embedding.length, vector })
      .onConflictDoNothing()
      .run()

    tx.insert(paths)
      .values({ blobHash, path })
      .run()
  })
}
