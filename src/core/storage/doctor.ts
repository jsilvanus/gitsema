/**
 * Cross-store health checks for non-sqlite `StorageProfile`s (Phase 103).
 *
 * `src/core/db/doctor.ts` runs deep, sqlite-specific checks (schema version,
 * `PRAGMA integrity_check`, FTS5 backfill status, ...) directly against a
 * `better-sqlite3` handle. For postgres/qdrant profiles there is no single
 * database file to inspect, so this module runs the subset of checks that are
 * possible through the `StorageProfile` seam: row counts from `metadata`
 * compared against the vector count from `vectors`, and FTS availability.
 */

import type { StorageBackend, StorageProfile, StorageScope } from './types.js'

export interface StorageDoctorReport {
  backend: StorageBackend
  scope: StorageScope
  location: string
  blobCount: number
  pathCount: number
  commitCount: number
  indexedCommitCount: number
  branchCount: number
  lastIndexedCommit?: string
  fileEmbeddingCount: number
  ftsEnabled: boolean
  warnings: string[]
}

/**
 * Runs the cross-store checks available for `profile` and returns a report.
 * Safe for postgres and qdrant profiles (and sqlite, though `runDoctor()` in
 * `core/db/doctor.ts` is the richer check for that backend).
 */
export async function runStorageDoctor(profile: StorageProfile): Promise<StorageDoctorReport> {
  const stats = await profile.metadata.getStats()
  const fileEmbeddingCount = await profile.vectors.countFileEmbeddings()
  const warnings: string[] = []

  if (stats.blobCount > 0 && fileEmbeddingCount === 0) {
    warnings.push('No file embeddings found for any blob. Run: gitsema index')
  }
  if (fileEmbeddingCount > stats.blobCount) {
    warnings.push(
      `Vector store has more file embeddings (${fileEmbeddingCount}) than the metadata store has blobs ` +
        `(${stats.blobCount}) — the two stores may be out of sync. Consider re-running 'gitsema storage migrate'.`,
    )
  }
  if (profile.fts === null) {
    warnings.push("FTS/hybrid search is disabled for this profile (storage.fts.backend = 'none').")
  }

  return {
    backend: profile.backend,
    scope: profile.scope,
    location: profile.location,
    ...stats,
    fileEmbeddingCount,
    ftsEnabled: profile.fts !== null,
    warnings,
  }
}
