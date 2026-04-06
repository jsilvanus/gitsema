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
  })
})
