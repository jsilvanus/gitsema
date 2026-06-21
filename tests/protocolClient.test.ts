import { describe, it, expect, vi, afterEach } from 'vitest'
import { callRemote, checkRemoteHealth } from '../src/core/remote/protocolClient.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callRemote', () => {
  it('posts { args } to /api/v1/protocol/:operation and returns result', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://localhost:4242/api/v1/protocol/mcp.semantic_search')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ args: { query: 'auth' } })
      return new Response(JSON.stringify({ result: { content: [{ type: 'text', text: 'ok' }] } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callRemote('mcp.semantic_search', { query: 'auth' }, { url: 'http://localhost:4242' })
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })

  it('sends Authorization header when key is set', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
      return new Response(JSON.stringify({ result: null }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await callRemote('lsp.hover', {}, { url: 'http://localhost:4242', key: 'secret' })
  })

  it('throws on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(callRemote('lsp.hover', {}, { url: 'http://localhost:4242' })).rejects.toThrow(/Remote protocol error 500/)
  })

  it('throws on { error } response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unknown operation' }), { status: 200 })))
    await expect(callRemote('lsp.bogus', {}, { url: 'http://localhost:4242' })).rejects.toThrow('unknown operation')
  })

  it('throws a timeout error when the request is aborted', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })))
    await expect(callRemote('lsp.hover', {}, { url: 'http://localhost:4242', timeoutMs: 5 })).rejects.toThrow(/timed out after 5ms/)
  })
})

describe('checkRemoteHealth', () => {
  it('resolves when /api/v1/status returns 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:4242/api/v1/status')
      return new Response('{}', { status: 200 })
    }))
    await expect(checkRemoteHealth({ url: 'http://localhost:4242' })).resolves.toBeUndefined()
  })

  it('throws when /api/v1/status returns non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(checkRemoteHealth({ url: 'http://localhost:4242' })).rejects.toThrow(/Remote health check failed: 401/)
  })
})
