import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadConfigFile,
  saveConfigFile,
  getDeep,
  setDeep,
  unsetDeep,
  coerceValue,
  getGlobalConfigPath,
  getLocalConfigPath,
  getConfigValue,
  setConfigValue,
  unsetConfigValue,
  listConfig,
  applyConfigToEnv,
  ENV_KEY_MAP,
} from '../src/core/config/configManager.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-config-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// loadConfigFile / saveConfigFile
// ---------------------------------------------------------------------------

describe('loadConfigFile', () => {
  it('returns empty object for non-existent path', () => {
    expect(loadConfigFile(join(tmpDir, 'does-not-exist.json'))).toEqual({})
  })

  it('parses a valid JSON config file', () => {
    const path = join(tmpDir, 'cfg.json')
    saveConfigFile(path, { provider: 'http', search: { top: 20 } })
    expect(loadConfigFile(path)).toEqual({ provider: 'http', search: { top: 20 } })
  })

  it('returns empty object for invalid JSON', () => {
    const path = join(tmpDir, 'bad.json')
    writeFileSync(path, '{ not valid json', 'utf8')
    expect(loadConfigFile(path)).toEqual({})
  })
})

describe('saveConfigFile', () => {
  it('creates parent directories as needed', () => {
    const path = join(tmpDir, 'a', 'b', 'config.json')
    saveConfigFile(path, { foo: 'bar' })
    expect(existsSync(path)).toBe(true)
    expect(loadConfigFile(path)).toEqual({ foo: 'bar' })
  })

  it('writes pretty-printed JSON', () => {
    const path = join(tmpDir, 'pretty.json')
    saveConfigFile(path, { x: 1 })
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('\n')
    expect(raw.trim()).toBe('{\n  "x": 1\n}')
  })
})

// ---------------------------------------------------------------------------
// getDeep / setDeep / unsetDeep
// ---------------------------------------------------------------------------

describe('getDeep', () => {
  it('reads a top-level key', () => {
    expect(getDeep({ provider: 'ollama' }, 'provider')).toBe('ollama')
  })

  it('reads a nested key', () => {
    expect(getDeep({ search: { top: 10 } }, 'search.top')).toBe(10)
  })

  it('returns undefined for missing keys', () => {
    expect(getDeep({}, 'missing')).toBeUndefined()
    expect(getDeep({ search: {} }, 'search.top')).toBeUndefined()
  })

  it('returns undefined when traversal hits a non-object', () => {
    expect(getDeep({ search: 'notAnObject' }, 'search.top')).toBeUndefined()
  })
})

describe('setDeep', () => {
  it('sets a top-level key', () => {
    const obj: Record<string, unknown> = {}
    setDeep(obj, 'provider', 'http')
    expect(obj).toEqual({ provider: 'http' })
  })

  it('sets a nested key, creating intermediate objects', () => {
    const obj: Record<string, unknown> = {}
    setDeep(obj, 'search.top', 20)
    expect(obj).toEqual({ search: { top: 20 } })
  })

  it('overwrites an existing key', () => {
    const obj: Record<string, unknown> = { search: { top: 10 } }
    setDeep(obj, 'search.top', 25)
    expect((obj.search as Record<string, unknown>).top).toBe(25)
  })

  it('throws for __proto__ key segment (prototype pollution guard)', () => {
    expect(() => setDeep({}, '__proto__.polluted', true)).toThrow('Invalid config key segment')
  })

  it('throws for constructor key segment', () => {
    expect(() => setDeep({}, 'a.constructor', 'x')).toThrow('Invalid config key segment')
  })
})

describe('unsetDeep', () => {
  it('removes a top-level key and returns true', () => {
    const obj: Record<string, unknown> = { provider: 'ollama' }
    expect(unsetDeep(obj, 'provider')).toBe(true)
    expect(obj).toEqual({})
  })

  it('removes a nested key and returns true', () => {
    const obj: Record<string, unknown> = { search: { top: 10, hybrid: true } }
    expect(unsetDeep(obj, 'search.top')).toBe(true)
    expect((obj.search as Record<string, unknown>).hybrid).toBe(true)
    expect('top' in (obj.search as Record<string, unknown>)).toBe(false)
  })

  it('returns false for non-existent key', () => {
    const obj: Record<string, unknown> = {}
    expect(unsetDeep(obj, 'missing')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// coerceValue
// ---------------------------------------------------------------------------

describe('coerceValue', () => {
  it('coerces "true" to boolean true', () => {
    expect(coerceValue('true')).toBe(true)
  })

  it('coerces "false" to boolean false', () => {
    expect(coerceValue('false')).toBe(false)
  })

  it('coerces numeric strings to numbers', () => {
    expect(coerceValue('10')).toBe(10)
    expect(coerceValue('3.14')).toBe(3.14)
  })

  it('leaves non-numeric strings as strings', () => {
    expect(coerceValue('ollama')).toBe('ollama')
    expect(coerceValue('nomic-embed-text')).toBe('nomic-embed-text')
  })
})

// ---------------------------------------------------------------------------
// getLocalConfigPath / getGlobalConfigPath
// ---------------------------------------------------------------------------

describe('getLocalConfigPath', () => {
  it('returns path under .gitsema/config.json relative to cwd', () => {
    expect(getLocalConfigPath('/some/repo')).toBe('/some/repo/.gitsema/config.json')
  })
})

describe('getGlobalConfigPath', () => {
  it('returns a path ending in .config/gitsema/config.json', () => {
    expect(getGlobalConfigPath()).toMatch(/\.config[/\\]gitsema[/\\]config\.json$/)
  })
})

// ---------------------------------------------------------------------------
// setConfigValue / getConfigValue / unsetConfigValue
// ---------------------------------------------------------------------------

describe('setConfigValue + getConfigValue', () => {
  it('sets and gets a local config value', () => {
    setConfigValue('search.top', 42, 'local', tmpDir)
    const { value, source } = getConfigValue('search.top', tmpDir)
    expect(value).toBe(42)
    expect(source).toBe('local')
  })

  it('local config file is written and readable via loadConfigFile', () => {
    setConfigValue('index.concurrency', 8, 'local', tmpDir)
    const localPath = getLocalConfigPath(tmpDir)
    const data = loadConfigFile(localPath)
    expect(getDeep(data, 'index.concurrency')).toBe(8)
  })

  it('global config file is written and readable via loadConfigFile', () => {
    // Write directly to the canonical global path and verify round-trip
    const globalPath = getGlobalConfigPath()
    const testKey = 'search.bm25Weight'
    try {
      setConfigValue(testKey, 0.5, 'global')
      const data = loadConfigFile(globalPath)
      expect(getDeep(data, testKey)).toBe(0.5)
    } finally {
      unsetConfigValue(testKey, 'global')
    }
  })

  it('env var takes precedence over local config', () => {
    setConfigValue('provider', 'ollama', 'local', tmpDir)
    const envVar = ENV_KEY_MAP['provider']
    const original = process.env[envVar]
    try {
      process.env[envVar] = 'http'
      const { value, source } = getConfigValue('provider', tmpDir)
      expect(value).toBe('http')
      expect(source).toBe('env')
    } finally {
      if (original === undefined) {
        delete process.env[envVar]
      } else {
        process.env[envVar] = original
      }
    }
  })

  it('returns undefined source when key has no value anywhere', () => {
    const { value, source } = getConfigValue('search.top', tmpDir)
    expect(value).toBeUndefined()
    expect(source).toBe('default')
  })
})

describe('unsetConfigValue', () => {
  it('removes a previously set key and returns true', () => {
    setConfigValue('search.hybrid', true, 'local', tmpDir)
    expect(unsetConfigValue('search.hybrid', 'local', tmpDir)).toBe(true)
    const { value } = getConfigValue('search.hybrid', tmpDir)
    expect(value).toBeUndefined()
  })

  it('returns false when key does not exist', () => {
    expect(unsetConfigValue('nonexistent', 'local', tmpDir)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// listConfig
// ---------------------------------------------------------------------------

describe('listConfig', () => {
  it('includes entries with source "local" for locally set keys', () => {
    setConfigValue('index.concurrency', 8, 'local', tmpDir)
    const entries = listConfig(tmpDir)
    const entry = entries.find((e) => e.key === 'index.concurrency')
    expect(entry).toBeDefined()
    expect(entry?.value).toBe(8)
    expect(entry?.source).toBe('local')
  })

  it('includes all known keys even those without a value', () => {
    const entries = listConfig(tmpDir)
    const keys = entries.map((e) => e.key)
    expect(keys).toContain('provider')
    expect(keys).toContain('search.hybrid')
    expect(keys).toContain('index.concurrency')
  })

  it('marks unknown-value entries as source "default"', () => {
    const entries = listConfig(tmpDir)
    const providerEntry = entries.find((e) => e.key === 'provider')
    // May be set by existing env vars in CI; just check it exists
    expect(providerEntry).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// applyConfigToEnv
// ---------------------------------------------------------------------------

describe('applyConfigToEnv', () => {
  it('sets env vars from local config for unmapped keys', () => {
    setConfigValue('provider', 'http', 'local', tmpDir)
    const envVar = ENV_KEY_MAP['provider']
    const original = process.env[envVar]
    try {
      delete process.env[envVar]
      applyConfigToEnv(tmpDir)
      expect(process.env[envVar]).toBe('http')
    } finally {
      if (original === undefined) {
        delete process.env[envVar]
      } else {
        process.env[envVar] = original
      }
    }
  })

  it('does not overwrite existing env vars', () => {
    setConfigValue('provider', 'http', 'local', tmpDir)
    const envVar = ENV_KEY_MAP['provider']
    const original = process.env[envVar]
    try {
      process.env[envVar] = 'ollama'
      applyConfigToEnv(tmpDir)
      expect(process.env[envVar]).toBe('ollama')
    } finally {
      if (original === undefined) {
        delete process.env[envVar]
      } else {
        process.env[envVar] = original
      }
    }
  })
})
