import { getRawDb } from '../../core/db/sqlite.js'
import { runVacuum } from '../../core/db/vacuum.js'

export async function vacuumCommand(): Promise<void> {
  const rawDb = getRawDb()
  console.log('Running VACUUM + ANALYZE on index database...')
  const t0 = Date.now()
  runVacuum(rawDb)
  console.log(`Done in ${Date.now() - t0}ms`)
}
