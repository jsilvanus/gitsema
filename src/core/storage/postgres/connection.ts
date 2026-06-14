/**
 * Postgres connection pooling for the storage seam (Phase 102).
 *
 * Pools are cached by connection string so repeated `resolveStorageProfile()`
 * calls against the same `storage.metadata.url` share a single pool, mirroring
 * the SQLite adapter's cached-session behavior.
 */

import { Pool } from 'pg'

const pools = new Map<string, Pool>()

/** Returns the cached `pg.Pool` for `connectionString`, creating it if needed. */
export function getPgPool(connectionString: string): Pool {
  let pool = pools.get(connectionString)
  if (!pool) {
    pool = new Pool({ connectionString })
    pools.set(connectionString, pool)
  }
  return pool
}

/** Closes and forgets all cached pools (tests). */
export async function closeAllPgPools(): Promise<void> {
  const all = [...pools.values()]
  pools.clear()
  await Promise.all(all.map((pool) => pool.end()))
}
