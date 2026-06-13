/**
 * Tests for `gitsema models add --provider cli ...` (src/cli/commands/models.ts).
 *
 * Verifies that CLI-provider narrator/guide configs round-trip through
 * embed_config/params_json and that `models list` displays them correctly.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { openDatabaseAt } from '../src/core/db/sqlite.js'

const testSession = openDatabaseAt(':memory:')
const rawDb = testSession.rawDb

afterEach(() => {
  rawDb.exec(`DELETE FROM embed_config WHERE kind IN ('narrator', 'guide')`)
  rawDb.exec(`DELETE FROM settings`)
  vi.restoreAllMocks()
  vi.resetModules()
})

function mockDb(): void {
  vi.doMock('../src/core/db/sqlite.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
    return { ...actual, getRawDb: () => rawDb }
  })
}

describe('models add --provider cli', () => {
  it('saves a CLI narrator config with cliCommand and cliArgs', async () => {
    mockDb()
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')
    const { getNarratorConfigByName } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('claude-cli', 'narrator', {
      provider: 'cli',
      cliCommand: 'claude',
      cliArgs: '--model opus',
    })

    const config = getNarratorConfigByName(rawDb, 'claude-cli')
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('cli')
    expect(config!.params).toEqual({ cliCommand: 'claude', cliArgs: ['--model', 'opus'] })
  })

  it('saves a CLI guide config with useMcp and activates it', async () => {
    mockDb()
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')
    const { getGuideConfigByName, getActiveGuideConfigId } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('claude-guide-cli', 'guide', {
      provider: 'cli',
      cliCommand: 'claude',
      useMcp: true,
      activate: true,
    })

    const config = getGuideConfigByName(rawDb, 'claude-guide-cli')
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('cli')
    expect(config!.params).toEqual({ cliCommand: 'claude', useMcp: true })
    expect(getActiveGuideConfigId(rawDb)).toBe(config!.id)
  })

  it('errors when --provider cli is given without --cli-command', async () => {
    mockDb()
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: number) => never
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(modelsKindAddCommand('bad-cli', 'narrator', { provider: 'cli' })).rejects.toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--cli-command is required'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('models add --provider ollama', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves an ollama narrator config with default http://localhost:11434 endpoint', async () => {
    mockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) })))
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')
    const { getNarratorConfigByName } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('llama3.1:8b', 'narrator', {
      provider: 'ollama',
      activate: true,
    })

    const config = getNarratorConfigByName(rawDb, 'llama3.1:8b')
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('ollama')
    expect(config!.params).toMatchObject({ httpUrl: 'http://localhost:11434' })
  })

  it('uses --global-name as the model id sent to the chat API', async () => {
    mockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) })))
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')
    const { getGuideConfigByName } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('my-guide', 'guide', {
      provider: 'ollama',
      globalName: 'llama3.1:8b',
    })

    const config = getGuideConfigByName(rawDb, 'my-guide')
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('ollama')
    expect(config!.params).toMatchObject({ httpUrl: 'http://localhost:11434', model: 'llama3.1:8b' })
  })

  it('respects a custom --http-url', async () => {
    mockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) })))
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')
    const { getNarratorConfigByName } = await import('../src/core/narrator/resolveNarrator.js')

    await modelsKindAddCommand('remote-ollama', 'narrator', {
      provider: 'ollama',
      httpUrl: 'http://ollama-host:11434',
    })

    const config = getNarratorConfigByName(rawDb, 'remote-ollama')
    expect(config!.params).toMatchObject({ httpUrl: 'http://ollama-host:11434' })
  })
})

describe('models add — no name + --provider ollama discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists available Ollama models when no name is given', async () => {
    mockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.1:8b' }, { name: 'nomic-embed-text:latest' }] }),
    })))
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: number) => never

    await modelsKindAddCommand(undefined, 'narrator', { provider: 'ollama' })

    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).toContain('llama3.1:8b')
    expect(output).toContain('nomic-embed-text:latest')
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('errors when no name is given and Ollama has no models', async () => {
    mockDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) })))
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: number) => never

    await expect(modelsKindAddCommand(undefined, 'guide', { provider: 'ollama' })).rejects.toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('model name is required'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('errors for non-ollama providers when no name is given', async () => {
    mockDb()
    const { modelsKindAddCommand } = await import('../src/cli/commands/models.js')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: number) => never

    await expect(modelsKindAddCommand(undefined, 'narrator', { httpUrl: 'https://api.example.com' })).rejects.toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith('Error: model name is required')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('models list — CLI provider display', () => {
  it('shows cliCommand and --use-mcp in the listing instead of an HTTP URL', async () => {
    mockDb()
    const { modelsKindAddCommand, modelsKindListCommand } = await import('../src/cli/commands/models.js')

    await modelsKindAddCommand('list-cli', 'narrator', {
      provider: 'cli',
      cliCommand: 'codex',
      useMcp: true,
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await modelsKindListCommand('narrator', {})
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')

    expect(output).toContain('cli: codex (--use-mcp)')
  })
})
