import { getActiveSession } from '../db/sqlite.js'
import { blobs } from '../db/schema.js'
import { inArray } from 'drizzle-orm'
import type { BlobHash } from '../models/types.js'

/**
 * Returns the subset of hashes that are NOT yet in the blobs table.
 * Operates in batches to stay within SQLite's variable limit.
 */
export async function filterNewBlobs(hashes: BlobHash[]): Promise<Set<BlobHash>> {
  if (hashes.length === 0) return new Set()

  const { db } = getActiveSession()
  const BATCH = 500
  const known = new Set<BlobHash>()

  for (let i = 0; i < hashes.length; i += BATCH) {
    const batch = hashes.slice(i, i + BATCH)
    const rows = db.select({ blobHash: blobs.blobHash }).from(blobs).where(inArray(blobs.blobHash, batch)).all()
    for (const row of rows) known.add(row.blobHash)
  }

  return new Set(hashes.filter((h) => !known.has(h)))
}

/**
 * Returns true if the blob is already indexed.
 */
export function isIndexed(blobHash: BlobHash): boolean {
  const { db } = getActiveSession()
  const row = db.select({ blobHash: blobs.blobHash }).from(blobs).where(inArray(blobs.blobHash, [blobHash])).get()
  return row !== undefined
}
