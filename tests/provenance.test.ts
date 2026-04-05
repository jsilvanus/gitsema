import { describe, it, expect } from 'vitest'
import { computeConfigHash, type EmbedConfig } from '../src/core/indexing/provenance.js'
import Database from 'better-sqlite3'
import { saveEmbedConfig, loadEmbedConfigs, checkConfigCompatibility } from '../src/core/indexing/provenance.js'

describe('computeConfigHash', () => {
  it('is deterministic', () => {
    const config: EmbedConfig = {
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
      chunker: 'file',
    }
    expect(computeConfigHash(config)).toBe(computeConfigHash(config))
  })

  it('is stable regardless of key insertion order', () => {
    const a: EmbedConfig = { provider: 'ollama', model: 'nomic', dimensions: 768, chunker: 'file' }
    const b: EmbedConfig = { chunker: 'file', dimensions: 768, model: 'nomic', provider: 'ollama' }
    expect(computeConfigHash(a)).toBe(computeConfigHash(b))
  })

  it('differs for different dimensions', () => {
    const a: EmbedConfig = { provider: 'ollama', model: 'nomic', dimensions: 768, chunker: 'file' }
    const b: EmbedConfig = { provider: 'ollama', model: 'nomic', dimensions: 1536, chunker: 'file' }
    expect(computeConfigHash(a)).not.toBe(computeConfigHash(b))
  })
})

function makeTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE embed_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_hash TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      code_model TEXT,
      dimensions INTEGER NOT NULL,
      chunker TEXT NOT NULL,
      window_size INTEGER,
      overlap INTEGER,
      created_at INTEGER NOT NULL
    )
  `)
  return db
}

describe('saveEmbedConfig / loadEmbedConfigs', () => {
  it('saves and loads a config', () => {
    const db = makeTestDb()
    const config: EmbedConfig = { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768, chunker: 'file' }
    saveEmbedConfig(db, config)
    const configs = loadEmbedConfigs(db)
    expect(configs).toHaveLength(1)
    expect(configs[0].model).toBe('nomic-embed-text')
    expect(configs[0].dimensions).toBe(768)
  })

  it('is idempotent (insert or ignore)', () => {
    const db = makeTestDb()
    const config: EmbedConfig = { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768, chunker: 'file' }
    saveEmbedConfig(db, config)
    saveEmbedConfig(db, config)
    expect(loadEmbedConfigs(db)).toHaveLength(1)
  })
})

describe('checkConfigCompatibility', () => {
  it('is compatible when no configs exist', () => {
    const db = makeTestDb()
    const config: EmbedConfig = { provider: 'ollama', model: 'nomic', dimensions: 768, chunker: 'file' }
    const result = checkConfigCompatibility(db, config)
    expect(result.compatible).toBe(true)
  })

  it('is compatible when same dimensions', () => {
    const db = makeTestDb()
    const config: EmbedConfig = { provider: 'ollama', model: 'nomic', dimensions: 768, chunker: 'file' }
    saveEmbedConfig(db, config)
    const result = checkConfigCompatibility(db, config)
    expect(result.compatible).toBe(true)
  })

  it('is compatible when different models have different dimensions (multi-model scenario)', () => {
    const db = makeTestDb()
    const existing: EmbedConfig = { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768, chunker: 'file' }
    saveEmbedConfig(db, existing)
    // Adding a second model with different dimensions is allowed
    const incoming: EmbedConfig = { provider: 'http', model: 'text-embedding-3-small', dimensions: 1536, chunker: 'file' }
    const result = checkConfigCompatibility(db, incoming)
    expect(result.compatible).toBe(true)
  })

  it('is incompatible when the same model name reappears with different dimensions', () => {
    const db = makeTestDb()
    const existing: EmbedConfig = { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768, chunker: 'file' }
    saveEmbedConfig(db, existing)
    // Same model name but different dimensions — indicates a corrupt re-index attempt
    const incoming: EmbedConfig = { provider: 'ollama', model: 'nomic-embed-text', dimensions: 1536, chunker: 'file' }
    const result = checkConfigCompatibility(db, incoming)
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain('nomic-embed-text')
    expect(result.reason).toContain('768')
    expect(result.reason).toContain('1536')
  })
})
