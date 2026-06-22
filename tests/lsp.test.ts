import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseMessage, serializeMessage, handleRequest } from '../src/core/lsp/server.js'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'

describe('lsp server framing', () => {
  it('parses and serializes messages', () => {
    const req = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
    const framed = serializeMessage(req)
    const parsed = parseMessage(Buffer.from(framed, 'utf8'))
    expect(parsed).not.toBeNull()
    expect(parsed?.method).toBe('initialize')
  })

  it('handles initialize request', async () => {
    const session = openDatabaseAt(':memory:')
    const res = await handleRequest(session, { jsonrpc: '2.0', id: 10, method: 'initialize' })
    expect(res).not.toBeNull()
    expect(res?.result?.capabilities?.hoverProvider).toBe(true)
    expect(res?.result?.capabilities?.definitionProvider).toBe(true)
    expect(res?.result?.capabilities?.referencesProvider).toBe(true)
  })

  it('handles textDocument/references with empty db gracefully', async () => {
    const session = openDatabaseAt(':memory:')
    const res = await withDbSession(session, () => handleRequest(session, {
      jsonrpc: '2.0',
      id: 11,
      method: 'textDocument/references',
      params: { text: 'authenticate' },
    }))
    expect(res).not.toBeNull()
    // With empty DB it should return an empty array (no error)
    expect(res?.result).toBeDefined()
    expect(Array.isArray(res?.result)).toBe(true)
  })

  it('handles textDocument/definition with empty db gracefully', async () => {
    const session = openDatabaseAt(':memory:')
    const res = await withDbSession(session, () => handleRequest(session, {
      jsonrpc: '2.0',
      id: 12,
      method: 'textDocument/definition',
      params: { text: 'myFunction' },
    }))
    expect(res).not.toBeNull()
    expect(res?.id).toBe(12)
    // With empty DB, result should be an empty array (no symbols) or an error
    const isSuccess = Array.isArray(res?.result)
    const isError = res?.error != null
    expect(isSuccess || isError).toBe(true)
  })
})

describe('lsp server remote delegation (Phase 113)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delegates textDocument/hover to the remote when --remote is set', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:4242/api/v1/protocol/lsp.hover')
      return new Response(JSON.stringify({ result: { contents: 'remote hover' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const session = openDatabaseAt(':memory:')
    const res = await handleRequest(
      session,
      { jsonrpc: '2.0', id: 20, method: 'textDocument/hover', params: { text: 'foo' } },
      { url: 'http://localhost:4242' },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res?.result).toEqual({ contents: 'remote hover' })
  })

  it('returns a JSON-RPC error when the remote call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))

    const session = openDatabaseAt(':memory:')
    const res = await handleRequest(
      session,
      { jsonrpc: '2.0', id: 21, method: 'textDocument/definition', params: { text: 'foo' } },
      { url: 'http://localhost:4242' },
    )
    expect(res?.error?.code).toBe(-32000)
    expect(res?.error?.message).toMatch(/Remote protocol error 500/)
  })

  it('does not delegate protocol-level methods like initialize even when --remote is set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const session = openDatabaseAt(':memory:')
    const res = await handleRequest(
      session,
      { jsonrpc: '2.0', id: 22, method: 'initialize' },
      { url: 'http://localhost:4242' },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res?.result?.capabilities?.hoverProvider).toBe(true)
  })
})

