import { getRawDb } from '../db/sqlite.js'
import { showBlob } from '../git/showBlob.js'
import { DEFAULT_MAX_SIZE } from '../git/showBlob.js'

export interface BackfillFtsOptions {
  repoPath?: string
  maxBlobSize?: number
  onProgress?: (done: number, total: number) => void
}

export interface BackfillFtsStats {
  total: number
  backfilled: number
  oversized: number
  failed: number
  elapsed: number
}

/**
 * Populates the FTS5 `blob_fts` table for blobs that were indexed before
 * Phase 11 and therefore have no stored text content.
 *
 * For each blob missing from `blob_fts`, the raw content is re-fetched from
 * the Git object store and inserted so that hybrid (BM25 + vector) search
 * and `--include-content` in evolution dumps work correctly.
 */
export async function backfillFts(options: BackfillFtsOptions = {}): Promise<BackfillFtsStats> {
  const { repoPath = '.', maxBlobSize = DEFAULT_MAX_SIZE, onProgress } = options
  const raw = getRawDb()
  const start = Date.now()

  // Find all blobs that have no FTS5 entry
  const rows = raw.prepare(`
    SELECT b.blob_hash
    FROM blobs b
    LEFT JOIN blob_fts f ON b.blob_hash = f.blob_hash
    WHERE f.blob_hash IS NULL
  `).all() as Array<{ blob_hash: string }>

  const total = rows.length
  let backfilled = 0
  let oversized = 0
  let failed = 0

  const insertStmt = raw.prepare(`INSERT INTO blob_fts (blob_hash, content) VALUES (?, ?)`)
  const deleteStmt = raw.prepare(`DELETE FROM blob_fts WHERE blob_hash = ?`)

  for (let i = 0; i < rows.length; i++) {
    const { blob_hash } = rows[i]

    try {
      const content = await showBlob(blob_hash, repoPath, maxBlobSize)
      if (content === null) {
        oversized++
      } else {
        const text = content.toString('utf8')
        deleteStmt.run(blob_hash)
        insertStmt.run(blob_hash, text)
        backfilled++
      }
    } catch {
      failed++
    }

    onProgress?.(i + 1, total)
  }

  return { total, backfilled, oversized, failed, elapsed: Date.now() - start }
}
