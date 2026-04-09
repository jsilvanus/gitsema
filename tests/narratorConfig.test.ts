/**
 * Tests for DB-backed narrator model config.
 *
 * Covers:
 *   - saveNarratorConfig / listNarratorConfigs / getNarratorConfigByName / deleteNarratorConfig
 *   - setActiveNarratorConfig / getActiveNarratorConfig / clearActiveNarratorConfig
 *   - resolveNarratorProvider (disabled when unconfigured)
 *   - embed_config kind filtering (narrator configs don't appear in embedding lists)
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'
import {
  listNarratorConfigs,
  getNarratorConfigById,
  getNarratorConfigByName,
  saveNarratorConfig,
  deleteNarratorConfig,
  getActiveNarratorConfig,
  getActiveNarratorConfigId,
  setActiveNarratorConfig,
  clearActiveNarratorConfig,
} from '../src/core/narrator/resolveNarrator.js'

// ---------------------------------------------------------------------------
// Test DB setup
// ---------------------------------------------------------------------------

const testSession = openDatabaseAt(':memory:')
const rawDb = testSession.rawDb

// ---------------------------------------------------------------------------
// Narrator config CRUD
// ---------------------------------------------------------------------------

describe('listNarratorConfigs()', () => {
  afterEach(() => {
    rawDb.exec(`DELETE FROM embed_config WHERE kind = 'narrator'`)
    rawDb.exec(`DELETE FROM settings`)
  })

  it('returns empty array when no narrator configs exist', () => {
    const configs = listNarratorConfigs(rawDb)
    expect(configs).toEqual([])
  })

  it('saves and retrieves a narrator config', () => {
    saveNarratorConfig(rawDb, 'my-narrator', 'chattydeer', { httpUrl: 'http://localhost:8080', apiKey: 'tok' })
    const configs = listNarratorConfigs(rawDb)
    expect(configs).toHaveLength(1)
    expect(configs[0].name).toBe('my-narrator')
    expect(configs[0].provider).toBe('chattydeer')
    expect(configs[0].params.httpUrl).toBe('http://localhost:8080')
    expect(configs[0].params.apiKey).toBe('tok')
  })

  it('does not include embedding configs in narrator list', () => {
    // Insert an embedding-kind row manually
    rawDb.exec(`
      INSERT INTO embed_config (config_hash, provider, model, dimensions, chunker, created_at, kind)
      VALUES ('hash_emb', 'ollama', 'nomic-embed-text', 768, 'file', ${Math.floor(Date.now() / 1000)}, 'embedding')
    `)
    const configs = listNarratorConfigs(rawDb)
    expect(configs.every((c) => c.provider !== 'ollama')).toBe(true)
  })

  it('returns multiple narrator configs ordered by created_at', () => {
    saveNarratorConfig(rawDb, 'narrator-a', 'chattydeer', { httpUrl: 'http://a.example.com' })
    saveNarratorConfig(rawDb, 'narrator-b', 'chattydeer', { httpUrl: 'http://b.example.com' })
    const configs = listNarratorConfigs(rawDb)
    expect(configs).toHaveLength(2)
    expect(configs[0].name).toBe('narrator-a')
    expect(configs[1].name).toBe('narrator-b')
  })
})

describe('getNarratorConfigByName()', () => {
  afterEach(() => {
    rawDb.exec(`DELETE FROM embed_config WHERE kind = 'narrator'`)
    rawDb.exec(`DELETE FROM settings`)
  })

  it('returns null for unknown name', () => {
    expect(getNarratorConfigByName(rawDb, 'ghost')).toBeNull()
  })

  it('returns config for known name', () => {
    saveNarratorConfig(rawDb, 'known', 'chattydeer', { httpUrl: 'http://x.example.com' })
    const config = getNarratorConfigByName(rawDb, 'known')
    expect(config).not.toBeNull()
    expect(config!.name).toBe('known')
  })
})

describe('getNarratorConfigById()', () => {
  afterEach(() => {
    rawDb.exec(`DELETE FROM embed_config WHERE kind = 'narrator'`)
    rawDb.exec(`DELETE FROM settings`)
  })

  it('returns null for unknown id', () => {
    expect(getNarratorConfigById(rawDb, 99999)).toBeNull()
  })

  it('returns config for known id', () => {
    const id = saveNarratorConfig(rawDb, 'by-id', 'chattydeer', { httpUrl: 'http://y.example.com' })
    const config = getNarratorConfigById(rawDb, id)
    expect(config).not.toBeNull()
    expect(config!.id).toBe(id)
  })
})

describe('deleteNarratorConfig()', () => {
  afterEach(() => {
    rawDb.exec(`DELETE FROM embed_config WHERE kind = 'narrator'`)
    rawDb.exec(`DELETE FROM settings`)
  })

  it('returns false when no config to delete', () => {
    expect(deleteNarratorConfig(rawDb, 'ghost')).toBe(false)
  })

  it('removes the config and returns true', () => {
    saveNarratorConfig(rawDb, 'del-me', 'chattydeer', { httpUrl: 'http://z.example.com' })
    expect(deleteNarratorConfig(rawDb, 'del-me')).toBe(true)
    expect(getNarratorConfigByName(rawDb, 'del-me')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Active narrator selection
// ---------------------------------------------------------------------------

describe('active narrator selection', () => {
  afterEach(() => {
    rawDb.exec(`DELETE FROM embed_config WHERE kind = 'narrator'`)
    rawDb.exec(`DELETE FROM settings`)
  })

  it('returns null when no active narrator is set', () => {
    expect(getActiveNarratorConfigId(rawDb)).toBeNull()
    expect(getActiveNarratorConfig(rawDb)).toBeNull()
  })

  it('returns the active config after setActiveNarratorConfig', () => {
    const id = saveNarratorConfig(rawDb, 'active-test', 'chattydeer', { httpUrl: 'http://active.example.com' })
    setActiveNarratorConfig(rawDb, id)
    expect(getActiveNarratorConfigId(rawDb)).toBe(id)
    const active = getActiveNarratorConfig(rawDb)
    expect(active).not.toBeNull()
    expect(active!.name).toBe('active-test')
  })

  it('returns null after clearActiveNarratorConfig', () => {
    const id = saveNarratorConfig(rawDb, 'clear-test', 'chattydeer', { httpUrl: 'http://clear.example.com' })
    setActiveNarratorConfig(rawDb, id)
    clearActiveNarratorConfig(rawDb)
    expect(getActiveNarratorConfigId(rawDb)).toBeNull()
    expect(getActiveNarratorConfig(rawDb)).toBeNull()
  })

  it('can switch the active narrator by setting a new id', () => {
    const id1 = saveNarratorConfig(rawDb, 'first', 'chattydeer', { httpUrl: 'http://first.example.com' })
    const id2 = saveNarratorConfig(rawDb, 'second', 'chattydeer', { httpUrl: 'http://second.example.com' })
    setActiveNarratorConfig(rawDb, id1)
    expect(getActiveNarratorConfig(rawDb)!.name).toBe('first')
    setActiveNarratorConfig(rawDb, id2)
    expect(getActiveNarratorConfig(rawDb)!.name).toBe('second')
  })
})

// ---------------------------------------------------------------------------
// resolveNarratorProvider (via mock session)
// ---------------------------------------------------------------------------

describe('resolveNarratorProvider()', () => {
  afterEach(() => {
    rawDb.exec(`DELETE FROM embed_config WHERE kind = 'narrator'`)
    rawDb.exec(`DELETE FROM settings`)
    vi.restoreAllMocks()
  })

  it('returns a disabled provider when no narrator model is configured', async () => {
    // Mock getActiveSession to use our in-memory DB
    vi.doMock('../src/core/db/sqlite.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
      return { ...actual, getActiveSession: () => testSession }
    })
    const { resolveNarratorProvider: resolveNarrator } = await import('../src/core/narrator/resolveNarrator.js')
    const provider = resolveNarrator({})
    expect(provider.modelName).toBe('narrator')

    const res = await provider.narrate({ systemPrompt: 'sys', userPrompt: 'user' })
    expect(res.llmEnabled).toBe(false)
    expect(res.prose).toContain('narrator disabled')
  })
})
