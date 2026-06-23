import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setConfigValue } from '../src/core/config/configManager.js'
import { loadEmbeddingProfileConfigs, buildProfileProviderMap } from '../src/core/embedding/profiles.js'
import { OllamaProvider } from '../src/core/embedding/local.js'
import { HttpProvider } from '../src/core/embedding/http.js'

let tmpDir: string
const ENV_KEY = 'GITSEMA_EMBEDDING_PROFILES'

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-embedding-profiles-test-'))
  delete process.env[ENV_KEY]
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env[ENV_KEY]
})

describe('loadEmbeddingProfileConfigs', () => {
  it('returns an empty array when nothing is configured', () => {
    expect(loadEmbeddingProfileConfigs(tmpDir)).toEqual([])
  })

  it('loads profiles from the GITSEMA_EMBEDDING_PROFILES env var', () => {
    process.env[ENV_KEY] = JSON.stringify([
      { name: 'fast', provider: 'ollama', textModel: 'nomic-embed-text' },
      { name: 'quality', provider: 'http', textModel: 'text-embedding-3-large', httpUrl: 'https://api.openai.com' },
    ])
    const profiles = loadEmbeddingProfileConfigs(tmpDir)
    expect(profiles).toHaveLength(2)
    expect(profiles[0].name).toBe('fast')
    expect(profiles[1].httpUrl).toBe('https://api.openai.com')
  })

  it('falls back to the embeddingProfiles config key when the env var is unset', () => {
    setConfigValue('embeddingProfiles', [
      { name: 'default', provider: 'ollama', textModel: 'nomic-embed-text' },
    ], 'local', tmpDir)
    const profiles = loadEmbeddingProfileConfigs(tmpDir)
    expect(profiles).toEqual([{ name: 'default', provider: 'ollama', textModel: 'nomic-embed-text' }])
  })

  it('throws on malformed JSON in the env var', () => {
    process.env[ENV_KEY] = '{not valid json'
    expect(() => loadEmbeddingProfileConfigs(tmpDir)).toThrow(/not valid JSON/)
  })

  it('throws on schema validation failure', () => {
    process.env[ENV_KEY] = JSON.stringify([{ name: 'bad name with spaces', provider: 'ollama', textModel: 'm' }])
    expect(() => loadEmbeddingProfileConfigs(tmpDir)).toThrow(/Invalid embeddingProfiles config/)
  })

  it('rejects unknown fields (strict schema)', () => {
    process.env[ENV_KEY] = JSON.stringify([{ name: 'p1', provider: 'ollama', textModel: 'm', extra: 'nope' }])
    expect(() => loadEmbeddingProfileConfigs(tmpDir)).toThrow(/Invalid embeddingProfiles config/)
  })

  it('throws on duplicate profile names', () => {
    process.env[ENV_KEY] = JSON.stringify([
      { name: 'dup', provider: 'ollama', textModel: 'm1' },
      { name: 'dup', provider: 'ollama', textModel: 'm2' },
    ])
    expect(() => loadEmbeddingProfileConfigs(tmpDir)).toThrow(/Duplicate embedding profile name: dup/)
  })
})

describe('buildProfileProviderMap', () => {
  it('builds one provider pair per profile, keyed by name', () => {
    const map = buildProfileProviderMap([
      { name: 'a', provider: 'ollama', textModel: 'nomic-embed-text' },
      { name: 'b', provider: 'http', textModel: 'text-embedding-3-large', httpUrl: 'https://api.openai.com' },
    ])
    expect(map.size).toBe(2)
    expect(map.get('a')?.textProvider).toBeInstanceOf(OllamaProvider)
    expect(map.get('b')?.textProvider).toBeInstanceOf(HttpProvider)
  })

  it('omits codeProvider when codeModel matches textModel or is unset', () => {
    const map = buildProfileProviderMap([
      { name: 'a', provider: 'ollama', textModel: 'nomic-embed-text' },
      { name: 'b', provider: 'ollama', textModel: 'nomic-embed-text', codeModel: 'nomic-embed-text' },
    ])
    expect(map.get('a')?.codeProvider).toBeUndefined()
    expect(map.get('b')?.codeProvider).toBeUndefined()
  })

  it('builds a distinct codeProvider when codeModel differs from textModel', () => {
    const map = buildProfileProviderMap([
      { name: 'a', provider: 'ollama', textModel: 'nomic-embed-text', codeModel: 'codebert' },
    ])
    expect(map.get('a')?.codeProvider).toBeInstanceOf(OllamaProvider)
  })

  it('propagates errors from buildProvider (e.g. http profile missing httpUrl)', () => {
    expect(() => buildProfileProviderMap([
      { name: 'a', provider: 'http', textModel: 'text-embedding-3-large' },
    ])).toThrow(/GITSEMA_HTTP_URL/)
  })
})
