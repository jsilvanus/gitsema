/**
 * Phase 118 — Postgres connection health-check probe (review9 §7.2).
 *
 * Unit tests against a mocked `pg.Pool` so they run without a live Postgres
 * instance (the conformance suite in `postgresStorageProfile.test.ts` covers
 * the real-database path, gated on `GITSEMA_TEST_POSTGRES_URL`).
 */

import { describe, it, expect, vi } from 'vitest'
import { verifyPgPool } from '../src/core/storage/postgres/connection.js'
import type { Pool } from 'pg'

function mockPool(query: (...args: unknown[]) => unknown): Pool {
  return { query } as unknown as Pool
}

describe('verifyPgPool', () => {
  it('resolves silently when the probe query succeeds', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] })
    const pool = mockPool(query)
    await expect(verifyPgPool(pool)).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledWith('SELECT 1')
  })

  it('throws an actionable error referencing the config key when the probe fails', async () => {
    const query = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND bad-host'))
    const pool = mockPool(query)
    await expect(verifyPgPool(pool)).rejects.toThrow(/storage\.metadata\.url.*GITSEMA_STORAGE_METADATA_URL.*ENOTFOUND/s)
  })

  it('memoizes a successful probe — only queries once per pool', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const pool = mockPool(query)
    await verifyPgPool(pool)
    await verifyPgPool(pool)
    await verifyPgPool(pool)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('probes each distinct pool independently', async () => {
    const queryA = vi.fn().mockResolvedValue({ rows: [] })
    const queryB = vi.fn().mockResolvedValue({ rows: [] })
    await verifyPgPool(mockPool(queryA))
    await verifyPgPool(mockPool(queryB))
    expect(queryA).toHaveBeenCalledTimes(1)
    expect(queryB).toHaveBeenCalledTimes(1)
  })
})
