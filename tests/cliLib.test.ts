import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveModels } from '../src/cli/lib/provider.js'
import {
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
  EXIT_GATE_FAILED,
  indexMissingHint,
  providerUnreachableHint,
} from '../src/cli/lib/errors.js'

const ENV_KEYS = [
  'GITSEMA_PROVIDER',
  'GITSEMA_MODEL',
  'GITSEMA_TEXT_MODEL',
  'GITSEMA_CODE_MODEL',
] as const

describe('resolveModels', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it('falls back to nomic-embed-text and ollama when nothing is set', () => {
    const result = resolveModels({})
    expect(result.providerType).toBe('ollama')
    expect(result.textModel).toBe('nomic-embed-text')
    expect(result.codeModel).toBe('nomic-embed-text')
  })

  it('uses GITSEMA_MODEL as the fallback for text and code models', () => {
    process.env.GITSEMA_MODEL = 'my-model'
    const result = resolveModels({})
    expect(result.textModel).toBe('my-model')
    expect(result.codeModel).toBe('my-model')
  })

  it('GITSEMA_TEXT_MODEL and GITSEMA_CODE_MODEL take precedence over GITSEMA_MODEL', () => {
    process.env.GITSEMA_MODEL = 'base-model'
    process.env.GITSEMA_TEXT_MODEL = 'text-model'
    process.env.GITSEMA_CODE_MODEL = 'code-model'
    const result = resolveModels({})
    expect(result.textModel).toBe('text-model')
    expect(result.codeModel).toBe('code-model')
  })

  it('respects GITSEMA_PROVIDER', () => {
    process.env.GITSEMA_PROVIDER = 'http'
    const result = resolveModels({})
    expect(result.providerType).toBe('http')
  })

  it('applies CLI --model override to both text and code models via env', () => {
    const result = resolveModels({ model: 'cli-model' })
    expect(result.textModel).toBe('cli-model')
    expect(result.codeModel).toBe('cli-model')
    expect(process.env.GITSEMA_MODEL).toBe('cli-model')
  })

  it('applies CLI --text-model and --code-model overrides independently', () => {
    const result = resolveModels({ textModel: 'cli-text', codeModel: 'cli-code' })
    expect(result.textModel).toBe('cli-text')
    expect(result.codeModel).toBe('cli-code')
  })

  it('--text-model override does not affect codeModel when codeModel is unset', () => {
    const result = resolveModels({ textModel: 'cli-text' })
    expect(result.textModel).toBe('cli-text')
    expect(result.codeModel).toBe('cli-text')
  })
})

describe('exit code constants', () => {
  it('match the agreed contract', () => {
    expect(EXIT_OK).toBe(0)
    expect(EXIT_RUNTIME).toBe(1)
    expect(EXIT_USAGE).toBe(2)
    expect(EXIT_GATE_FAILED).toBe(3)
  })
})

describe('error message helpers', () => {
  it('indexMissingHint mentions the default db path and `gitsema index`', () => {
    const msg = indexMissingHint()
    expect(msg).toContain('.gitsema/index.db')
    expect(msg).toContain('gitsema index')
  })

  it('indexMissingHint accepts a custom db path', () => {
    const msg = indexMissingHint('/tmp/custom/index.db')
    expect(msg).toContain('/tmp/custom/index.db')
  })

  it('providerUnreachableHint mentions doctor, quickstart, and env vars', () => {
    const msg = providerUnreachableHint('ollama')
    expect(msg).toContain('gitsema doctor')
    expect(msg).toContain('gitsema quickstart')
    expect(msg).toContain('GITSEMA_PROVIDER')
    expect(msg).toContain('GITSEMA_HTTP_URL')
    expect(msg).toContain('ollama')
  })

  it('providerUnreachableHint includes the URL when provided', () => {
    const msg = providerUnreachableHint('http', 'https://api.example.com')
    expect(msg).toContain('https://api.example.com')
  })
})
