import { getActiveSession } from '../db/sqlite.js'
import type { BlobHash } from '../models/types.js'

/**
 * Returns true if the blob already has an embedding for the given model.
 * A blob indexed with model A can be re-indexed with model B.
 */
export function isIndexed(blobHash: BlobHash, model: string): boolean {
  const { rawDb } = getActiveSession()
  const row = rawDb
    .prepare('SELECT 1 FROM embeddings WHERE blob_hash = ? AND model = ?')
    .get(blobHash, model) as { 1: number } | undefined
  return row !== undefined
}

/**
 * Returns the subset of hashes that do NOT yet have an embedding for `model`.
 * Operates in batches to stay within SQLite's variable limit.
 */
export async function filterNewBlobs(hashes: BlobHash[], model: string): Promise<Set<BlobHash>> {
  if (hashes.length === 0) return new Set()

  const { rawDb } = getActiveSession()
  const BATCH = 500
  const known = new Set<BlobHash>()

  for (let i = 0; i < hashes.length; i += BATCH) {
    const batch = hashes.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')
    const rows = rawDb
      .prepare(`SELECT blob_hash FROM embeddings WHERE model = ? AND blob_hash IN (${placeholders})`)
      .all(model, ...batch) as Array<{ blob_hash: BlobHash }>
    for (const row of rows) known.add(row.blob_hash)
  }

  return new Set(hashes.filter((h) => !known.has(h)))
}
