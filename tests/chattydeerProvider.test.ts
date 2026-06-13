/**
 * Tests for ChattydeerNarratorProvider's HTTP generate function
 * (src/core/narrator/chattydeerProvider.ts).
 *
 * Verifies that the `model` field sent to the OpenAI-compatible
 * /v1/chat/completions endpoint is the configured model id (params.model),
 * falling back to the config's local name — not a hardcoded 'default'
 * (which breaks Ollama and other providers that validate the model field).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const fakeExplain = vi.fn(async () => ({
  explanation: 'narrated text',
  labels: [],
  references: [],
  meta: {},
}))
const fakeDestroy = vi.fn(async () => {})

vi.mock('@jsilvanus/chattydeer', () => ({
  Explainer: {
    create: async (_modelName: string, opts: { generateFn: (prompt: string) => Promise<{ text: string; raw: null }> }) => {
      // Exercise the generateFn so the HTTP request is actually issued.
      await opts.generateFn('test prompt')
      return { explain: fakeExplain, destroy: fakeDestroy }
    },
  },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('ChattydeerNarratorProvider — model field in chat-completions request', () => {
  it('sends params.model when set (e.g. an Ollama tag)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const { createChattydeerProvider } = await import('../src/core/narrator/chattydeerProvider.js')
    const provider = createChattydeerProvider('my-guide', {
      httpUrl: 'http://localhost:11434',
      model: 'llama3.1:8b',
    })

    await provider.narrate({ systemPrompt: 'sys', userPrompt: 'user' })

    expect(fetchSpy).toHaveBeenCalled()
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('llama3.1:8b')
  })

  it('falls back to the config name when params.model is not set', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const { createChattydeerProvider } = await import('../src/core/narrator/chattydeerProvider.js')
    const provider = createChattydeerProvider('llama3.1:8b', {
      httpUrl: 'http://localhost:11434',
    })

    await provider.narrate({ systemPrompt: 'sys', userPrompt: 'user' })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('llama3.1:8b')
  })
})
