import type Database from 'better-sqlite3'
import { CURRENT_SCHEMA_VERSION } from './sqlite.js'

export interface DoctorReport {
  schemaVersion: number
  expectedVersion: number
  schemaOk: boolean
  blobCount: number
  embeddingCount: number
  ftsCount: number
  ftsMissingCount: number
  orphanEmbeddings: number
  integrityCheckPassed: boolean
  integrityErrors: string[]
  embedConfigs: Array<{
    configHash: string; provider: string; model: string
    dimensions: number; chunker: string; createdAt: number
  }>
  warnings: string[]
}

export function runDoctor(rawDb: InstanceType<typeof Database>): DoctorReport {
  const warnings: string[] = []

  // Schema version
  let schemaVersion = 0
  try {
    const row = rawDb.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined
    schemaVersion = row ? parseInt(row.value, 10) : 0
  } catch { /* meta table doesn't exist */ }
  const schemaOk = schemaVersion === CURRENT_SCHEMA_VERSION
  if (!schemaOk) warnings.push(`Schema version ${schemaVersion} != expected ${CURRENT_SCHEMA_VERSION}. Run migrations by opening the DB normally.`)

  // Blob count
  const blobCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM blobs').get() as { c: number })?.c ?? 0

  // Embedding count
  const embeddingCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM embeddings').get() as { c: number })?.c ?? 0

  // FTS count
  let ftsCount = 0
  let ftsMissingCount = 0
  try {
    ftsCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM blob_fts').get() as { c: number })?.c ?? 0
    ftsMissingCount = (rawDb.prepare(`
      SELECT COUNT(*) AS c FROM blobs b
      WHERE NOT EXISTS (SELECT 1 FROM blob_fts WHERE blob_fts.blob_hash = b.blob_hash)
    `).get() as { c: number })?.c ?? 0
  } catch {
    ftsMissingCount = blobCount
    warnings.push('FTS table missing or not initialized. Run: gitsema backfill-fts')
  }
  if (ftsMissingCount > 0) warnings.push(`${ftsMissingCount} blobs have no FTS row. Run: gitsema backfill-fts`)

  // Orphan embeddings (embeddings without corresponding blob)
  const orphanEmbeddings = (rawDb.prepare(`
    SELECT COUNT(*) AS c FROM embeddings e
    WHERE NOT EXISTS (SELECT 1 FROM blobs b WHERE b.blob_hash = e.blob_hash)
  `).get() as { c: number })?.c ?? 0
  if (orphanEmbeddings > 0) warnings.push(`${orphanEmbeddings} orphan embeddings detected. Run: gitsema gc`)

  // Integrity check
  const integrityErrors: string[] = []
  let integrityCheckPassed = true
  try {
    const rows = rawDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
    const msgs = rows.map((r) => r.integrity_check).filter((m) => m !== 'ok')
    if (msgs.length > 0) {
      integrityCheckPassed = false
      integrityErrors.push(...msgs)
      warnings.push(`SQLite integrity check failed: ${msgs.join('; ')}`)
    }
  } catch (err) {
    integrityCheckPassed = false
    integrityErrors.push(String(err))
  }

  // Embed configs
  let embedConfigs: DoctorReport['embedConfigs'] = []
  try {
    embedConfigs = (rawDb.prepare('SELECT config_hash, provider, model, dimensions, chunker, created_at FROM embed_config ORDER BY created_at ASC').all() as Array<{
      config_hash: string; provider: string; model: string; dimensions: number; chunker: string; created_at: number
    }>).map((r) => ({
      configHash: r.config_hash,
      provider: r.provider,
      model: r.model,
      dimensions: r.dimensions,
      chunker: r.chunker,
      createdAt: r.created_at,
    }))
  } catch { /* embed_config table might not exist on older DBs */ }

  if (embedConfigs.length === 0 && embeddingCount > 0) {
    warnings.push('No embed_config rows found. Provenance tracking will be incomplete until next index run.')
  }

  return {
    schemaVersion,
    expectedVersion: CURRENT_SCHEMA_VERSION,
    schemaOk,
    blobCount,
    embeddingCount,
    ftsCount,
    ftsMissingCount,
    orphanEmbeddings,
    integrityCheckPassed,
    integrityErrors,
    embedConfigs,
    warnings,
  }
}
