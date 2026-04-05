import type Database from 'better-sqlite3'
import { logger } from '../../utils/logger.js'

export function runVacuum(rawDb: InstanceType<typeof Database>): void {
  logger.info('Running VACUUM...')
  const t0 = Date.now()
  rawDb.exec('VACUUM')
  logger.info(`VACUUM completed in ${Date.now() - t0}ms`)
  logger.info('Running ANALYZE...')
  rawDb.exec('ANALYZE')
  logger.info('ANALYZE completed.')
}
