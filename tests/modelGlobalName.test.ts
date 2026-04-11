/**
 * Tests for the model `globalName` (local shorthand) feature.
 *
 * Verifies that:
 *  - `ModelProfile.globalName` is persisted and retrieved correctly.
 *  - `buildProviderForModel()` sends the globalName (not the local name) to
 *    the underlying provider.
 *  - `getTextProvider()` / `getCodeProvider()` honour globalName resolution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getModelProfile,
  setModelProfile,
} from '../src/core/config/configManager.js'

// ---------------------------------------------------------------------------
// Test isolation
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-globalname-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// configManager — ModelProfile.globalName persistence
// ---------------------------------------------------------------------------

describe('ModelProfile.globalName — configManager', () => {
  it('stores and retrieves globalName in local config', () => {
    setModelProfile(
      'my-embed',
      { globalName: 'hf.co/org/model:latest', provider: 'ollama' },
      'local',
      tmpDir,
    )
    const profile = getModelProfile('my-embed', tmpDir)
    expect(profile.globalName).toBe('hf.co/org/model:latest')
    expect(profile.provider).toBe('ollama')
  })

  it('returns undefined globalName when not configured', () => {
    setModelProfile('no-alias', { provider: 'ollama' }, 'local', tmpDir)
    const profile = getModelProfile('no-alias', tmpDir)
    expect(profile.globalName).toBeUndefined()
  })

  it('globalName can be updated independently of other fields', () => {
    setModelProfile('updatable', { provider: 'ollama', level: 'file' }, 'local', tmpDir)
    setModelProfile('updatable', { globalName: 'hf.co/new-model' }, 'local', tmpDir)
    const profile = getModelProfile('updatable', tmpDir)
    expect(profile.globalName).toBe('hf.co/new-model')
    // Existing fields should still be present
    expect(profile.provider).toBe('ollama')
    expect(profile.level).toBe('file')
  })

  it('last-write wins when updating globalName', () => {
    setModelProfile('overwrite', { globalName: 'first-remote' }, 'local', tmpDir)
    setModelProfile('overwrite', { globalName: 'second-remote' }, 'local', tmpDir)
    const profile = getModelProfile('overwrite', tmpDir)
    expect(profile.globalName).toBe('second-remote')
  })

  it('globalName coexists with prefixes and extRoles', () => {
    setModelProfile(
      'full-model',
      {
        globalName: 'hf.co/org/full:latest',
        provider: 'http',
        httpUrl: 'https://api.example.com',
        prefixes: { code: 'search_document:', query: 'search_query:' },
        extRoles: { '.ipynb': 'jupyter' },
      },
      'local',
      tmpDir,
    )
    const profile = getModelProfile('full-model', tmpDir)
    expect(profile.globalName).toBe('hf.co/org/full:latest')
    expect(profile.provider).toBe('http')
    expect(profile.prefixes?.['code']).toBe('search_document:')
    expect(profile.extRoles?.['.ipynb']).toBe('jupyter')
  })
})

// ---------------------------------------------------------------------------
// providerFactory — buildProviderForModel uses globalName
//
// We test via the real OllamaProvider / HttpProvider constructors (which only
// set `this.model` synchronously). We mock getModelProfile so that no config
// file I/O is needed per test. The mock defaults to calling through to the
// real implementation; individual tests override with mockReturnValue().
// ---------------------------------------------------------------------------

vi.mock('../src/core/config/configManager.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/config/configManager.js')>()
  return {
    ...actual,
    // By default calls through to real implementation; per-test overrides use vi.mocked().mockReturnValue()
    getModelProfile: vi.fn((name: string, cwd?: string) => actual.getModelProfile(name, cwd)),
  }
})

import { getModelProfile as getModelProfileMock } from '../src/core/config/configManager.js'
import { buildProviderForModel, getTextProvider, getCodeProvider } from '../src/core/embedding/providerFactory.js'

describe('buildProviderForModel — globalName resolution', () => {
  afterEach(() => {
    vi.mocked(getModelProfileMock).mockRestore()
    // Clean up env vars set during tests
    delete process.env.GITSEMA_TEXT_MODEL
    delete process.env.GITSEMA_CODE_MODEL
    delete process.env.GITSEMA_MODEL
    delete process.env.GITSEMA_PROVIDER
    delete process.env.GITSEMA_HTTP_URL
  })

  it('sends globalName to OllamaProvider when profile has a globalName', () => {
    vi.mocked(getModelProfileMock).mockReturnValue({
      globalName: 'hf.co/org/big-model:latest',
      provider: 'ollama',
    })
    const provider = buildProviderForModel('my-shorthand')
    // OllamaProvider exposes .model = the name passed to its constructor
    expect(provider.model).toBe('hf.co/org/big-model:latest')
  })

  it('falls back to the local name when globalName is absent', () => {
    vi.mocked(getModelProfileMock).mockReturnValue({ provider: 'ollama' })
    const provider = buildProviderForModel('plain-model')
    expect(provider.model).toBe('plain-model')
  })

  it('sends globalName to HttpProvider when provider is http', () => {
    vi.mocked(getModelProfileMock).mockReturnValue({
      globalName: 'text-embedding-3-large',
      provider: 'http',
      httpUrl: 'https://api.example.com',
    })
    const provider = buildProviderForModel('my-http-shorthand')
    expect(provider.model).toBe('text-embedding-3-large')
  })

  it('getTextProvider uses globalName from the resolved text model profile', () => {
    process.env.GITSEMA_TEXT_MODEL = 'my-text-shorthand'
    vi.mocked(getModelProfileMock).mockReturnValue({
      globalName: 'hf.co/org/text-model:v2',
      provider: 'ollama',
    })
    const provider = getTextProvider()
    // PrefixedProvider wraps the inner provider; unwrap if necessary
    // Both PrefixedProvider and OllamaProvider expose `.model`
    expect(provider.model).toBe('hf.co/org/text-model:v2')
  })

  it('getCodeProvider uses globalName from the resolved code model profile', () => {
    process.env.GITSEMA_CODE_MODEL = 'my-code-shorthand'
    vi.mocked(getModelProfileMock).mockReturnValue({
      globalName: 'hf.co/org/code-model:v1',
      provider: 'ollama',
    })
    const provider = getCodeProvider()
    expect(provider.model).toBe('hf.co/org/code-model:v1')
  })

  it('getTextProvider falls back to local name when no globalName set', () => {
    process.env.GITSEMA_TEXT_MODEL = 'nomic-embed-text'
    vi.mocked(getModelProfileMock).mockReturnValue({ provider: 'ollama' })
    const provider = getTextProvider()
    expect(provider.model).toBe('nomic-embed-text')
  })
})
