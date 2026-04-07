import { describe, it, expect, vi } from 'vitest'
import { parseMessage, serializeMessage, handleRequest } from '../src/core/lsp/server.js'
import { openDatabaseAt } from '../src/core/db/sqlite.js'

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
    const res = await handleRequest(session, {
      jsonrpc: '2.0',
      id: 11,
      method: 'textDocument/references',
      params: { text: 'authenticate' },
    })
    expect(res).not.toBeNull()
    // With empty DB it should return an empty array (no error)
    expect(res?.result).toBeDefined()
    expect(Array.isArray(res?.result)).toBe(true)
  })

  it('handles textDocument/definition with empty db gracefully', async () => {
    const session = openDatabaseAt(':memory:')
    const res = await handleRequest(session, {
      jsonrpc: '2.0',
      id: 12,
      method: 'textDocument/definition',
      params: { text: 'myFunction' },
    })
    expect(res).not.toBeNull()
    expect(res?.id).toBe(12)
    // With empty DB, result should be an empty array (no symbols) or an error
    const isSuccess = Array.isArray(res?.result)
    const isError = res?.error != null
    expect(isSuccess || isError).toBe(true)
  })
})

