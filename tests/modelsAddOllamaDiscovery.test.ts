/**
 * Tests for `gitsema models add` (embedding models) with no model name given —
 * should query Ollama's /api/tags and list available models.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { modelsAddCommand } from '../src/cli/commands/models.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('models add — no name (embedding models)', () => {
  it('lists available Ollama models when no name is given and provider defaults to ollama', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }, { name: 'mxbai-embed-large' }] }),
    })))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: number) => never

    await modelsAddCommand(undefined, {})

    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(output).toContain('nomic-embed-text:latest')
    expect(output).toContain('mxbai-embed-large')
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('errors when no name is given, provider is ollama, and Ollama has no models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) })))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: number) => never

    await expect(modelsAddCommand(undefined, { provider: 'ollama' })).rejects.toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('model name is required'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('errors immediately when no name is given and provider is http', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: number) => never

    await expect(modelsAddCommand(undefined, { provider: 'http', url: 'https://api.openai.com' })).rejects.toThrow('process.exit called')

    expect(errorSpy).toHaveBeenCalledWith('Error: model name is required')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
