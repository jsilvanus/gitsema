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

const verifiedPools = new WeakSet<Pool>()

/**
 * Probe a Postgres pool once (memoized per pool) so a bad URL / unreachable
 * server fails with an actionable message pointing at the config key, rather
 * than an opaque driver error at the first query (review9 §7.2).
 */
export async function verifyPgPool(pool: Pool): Promise<void> {
  if (verifiedPools.has(pool)) return
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Cannot connect to the Postgres storage backend ` +
      `(storage.metadata.url / GITSEMA_STORAGE_METADATA_URL): ${detail}`,
    )
  }
  verifiedPools.add(pool)
}

/** Closes and forgets all cached pools (tests). */
export async function closeAllPgPools(): Promise<void> {
  const all = [...pools.values()]
  pools.clear()
  await Promise.all(all.map((pool) => pool.end()))
}
