import type Database from 'better-sqlite3'
import { logger } from '../../utils/logger.js'

export interface RebuildFtsResult {
  rebuilt: number
}

/**
 * Rebuilds the FTS5 index by running `INSERT INTO blob_fts(blob_fts) VALUES ('rebuild')`.
 * Also re-populates any missing FTS rows from the stored blob content.
 */
export function rebuildFts(rawDb: InstanceType<typeof Database>): RebuildFtsResult {
  // Ensure FTS table exists
  const tableExists = (rawDb.prepare(
    `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='blob_fts'`
  ).get() as { c: number })?.c ?? 0

  if (!tableExists) {
    logger.warn('blob_fts table does not exist. Run: gitsema backfill-fts')
    return { rebuilt: 0 }
  }

  logger.info('Triggering FTS5 rebuild...')
  rawDb.exec(`INSERT INTO blob_fts(blob_fts) VALUES ('rebuild')`)

  const count = (rawDb.prepare('SELECT COUNT(*) AS c FROM blob_fts').get() as { c: number })?.c ?? 0
  logger.info(`FTS5 rebuild complete. ${count} rows in blob_fts.`)
  return { rebuilt: count }
}
