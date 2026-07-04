/**
 * Tests for request-scoped BYOK (bring-your-own-key) narrator/guide
 * credentials (Phase 130 / locked-model-set-plan.md §5 Phase 3).
 *
 * BYOK must:
 *   - never write to embed_config/settings (no persistence path)
 *   - never consult the model allow-list (Phase 129), even when every
 *     defined narrator/guide config is denied server-wide ("lock to none")
 *   - produce a working, enabled provider from the supplied credentials
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import {
  byokConfig,
  resolveNarratorProvider,
  resolveGuideConfig,
  saveNarratorConfig,
  saveGuideConfig,
} from '../src/core/narrator/resolveNarrator.js'
import { denyServer } from '../src/core/admin/modelPolicy.js'
import type { ByokCredentials } from '../src/core/narrator/types.js'

const testSession = openDatabaseAt(':memory:')
const rawDb = testSession.rawDb

afterEach(() => {
  rawDb.exec(`DELETE FROM embed_config WHERE kind IN ('narrator', 'guide')`)
  rawDb.exec(`DELETE FROM settings`)
  delete process.env.GITSEMA_BYOK_ALLOW_HOSTS
  vi.restoreAllMocks()
  vi.resetModules()
})

function countEmbedConfigRows(): number {
  const row = rawDb.prepare(`SELECT COUNT(*) as n FROM embed_config`).get() as { n: number }
  return row.n
}

const BYOK: ByokCredentials = {
  httpUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'byok-model',
  maxTokens: 256,
  temperature: 0.1,
}

describe('byokConfig()', () => {
  it('builds a sentinel config (id: -1) from BYOK credentials', async () => {
    const config = await byokConfig(BYOK)
    expect(config.id).toBe(-1)
    expect(config.provider).toBe('chattydeer')
    expect(config.name).toBe('byok-model')
    expect(config.params).toMatchObject({
      httpUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'byok-model',
      maxTokens: 256,
      temperature: 0.1,
    })
  })

  it('defaults the name to "byok" when no model id is supplied', async () => {
    const config = await byokConfig({ httpUrl: 'https://example.com/v1' })
    expect(config.name).toBe('byok')
  })

  it('rejects loopback URLs by default', async () => {
    await expect(byokConfig({ httpUrl: 'http://127.0.0.1:9999' })).rejects.toThrow('blocked')
  })

  it('allows allowlisted hosts and CIDRs via GITSEMA_BYOK_ALLOW_HOSTS', async () => {
    process.env.GITSEMA_BYOK_ALLOW_HOSTS = '127.0.0.1,10.0.0.0/8'
    const config = await byokConfig({ httpUrl: 'http://127.0.0.1:9999' })
    expect(config.params.httpUrl).toBe('http://127.0.0.1:9999')
  })
})

describe('resolveNarratorProvider({ byok }) — never persists, never DB-checked', () => {
  it('returns an enabled provider without touching embed_config/settings', async () => {
    const before = countEmbedConfigRows()
    const provider = await resolveNarratorProvider({ byok: BYOK })
    expect(provider.modelName).toBe('byok-model')
    expect(countEmbedConfigRows()).toBe(before)
  })

  it('bypasses the DB entirely (no getActiveSession call needed)', async () => {
    // Mock getActiveSession to throw — if resolveNarratorProvider tried to
    // touch the DB at all for a byok request, this test would fail.
    vi.doMock('../src/core/db/sqlite.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
      return {
        ...actual,
        getActiveSession: () => {
          throw new Error('getActiveSession should not be called for BYOK requests')
        },
      }
    })
    const { resolveNarratorProvider: resolveNarrator } = await import('../src/core/narrator/resolveNarrator.js')
    await expect(resolveNarrator({ byok: BYOK })).resolves.toBeDefined()
  })

  it('"lock to none" — BYOK still resolves even when every defined narrator config is denied server-wide', async () => {
    vi.doMock('../src/core/db/sqlite.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
      return { ...actual, getActiveSession: () => testSession }
    })
    const id = saveNarratorConfig(rawDb, 'only-narrator', 'chattydeer', { httpUrl: 'https://example.com/v1' })
    denyServer(rawDb, 'narrator', 'only-narrator', ['only-narrator'])
    void id

    const { resolveNarratorProvider: resolveNarrator } = await import('../src/core/narrator/resolveNarrator.js')
    const provider = await resolveNarrator({ byok: BYOK })
    expect(provider.modelName).toBe('byok-model')
  })
})

describe('resolveGuideConfig({ byok }) — never persists, never DB-checked', () => {
  it('returns the sentinel config without touching embed_config/settings', async () => {
    const before = countEmbedConfigRows()
    const config = await resolveGuideConfig({ byok: BYOK })
    expect(config).not.toBeNull()
    expect(config!.id).toBe(-1)
    expect(config!.name).toBe('byok-model')
    expect(countEmbedConfigRows()).toBe(before)
  })

  it('"lock to none" — BYOK still resolves even when every defined guide config is denied server-wide', async () => {
    vi.doMock('../src/core/db/sqlite.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
      return { ...actual, getActiveSession: () => testSession }
    })
    saveGuideConfig(rawDb, 'only-guide', 'chattydeer', { httpUrl: 'https://example.com/v1' })
    denyServer(rawDb, 'guide', 'only-guide', ['only-guide'])

    const { resolveGuideConfig: resolveGuide } = await import('../src/core/narrator/resolveNarrator.js')
    const config = await resolveGuide({ byok: BYOK })
    expect(config).not.toBeNull()
    expect(config!.id).toBe(-1)
  })

  it('bypasses the DB entirely (no getActiveSession call needed)', async () => {
    vi.doMock('../src/core/db/sqlite.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
      return {
        ...actual,
        getActiveSession: () => {
          throw new Error('getActiveSession should not be called for BYOK requests')
        },
      }
    })
    const { resolveGuideConfig: resolveGuide } = await import('../src/core/narrator/resolveNarrator.js')
    await expect(resolveGuide({ byok: BYOK })).resolves.toBeDefined()
  })
})
