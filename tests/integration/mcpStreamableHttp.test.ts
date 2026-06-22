/**
 * Integration tests for Phase 117 — the MCP Streamable HTTP transport. Uses
 * the SDK's real `StreamableHTTPClientTransport` (no hand-rolled client
 * needed, unlike the WebSocket transport's test, since it supports custom
 * request headers via `requestInit` for exercising auth).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startMcpStreamableHttpServer } from '../../src/mcp/streamableHttpServer.js'

let port = 18500
function nextPort(): number {
  return port++
}

const closers: Array<() => void> = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('MCP Streamable HTTP transport (Phase 117)', () => {
  it('round-trips tools/list and tools/call over a real HTTP session', async () => {
    const p = nextPort()
    const httpServer = startMcpStreamableHttpServer('127.0.0.1', p, undefined)
    closers.push(() => httpServer.close())
    await new Promise((r) => setTimeout(r, 100))

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${p}/mcp`))
    await client.connect(transport)

    const result = await client.listTools()
    expect(Array.isArray(result.tools)).toBe(true)
    expect(result.tools.length).toBeGreaterThan(0)
    expect(result.tools.some((t) => t.name === 'semantic_search')).toBe(true)

    await client.close()
  })

  it('reuses the same session across multiple sequential requests', async () => {
    const p = nextPort()
    const httpServer = startMcpStreamableHttpServer('127.0.0.1', p, undefined)
    closers.push(() => httpServer.close())
    await new Promise((r) => setTimeout(r, 100))

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${p}/mcp`))
    await client.connect(transport)

    const first = await client.listTools()
    expect(first.tools.length).toBeGreaterThan(0)
    expect(transport.sessionId).toBeDefined()
    const sessionId = transport.sessionId

    const second = await client.listTools()
    expect(second.tools.length).toBe(first.tools.length)
    expect(transport.sessionId).toBe(sessionId)

    await client.close()
  })

  it('rejects requests with a missing or wrong Bearer token', async () => {
    const p = nextPort()
    const httpServer = startMcpStreamableHttpServer('127.0.0.1', p, 'secret-token')
    closers.push(() => httpServer.close())
    await new Promise((r) => setTimeout(r, 100))

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${p}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer wrong-token' } },
    })
    await expect(client.connect(transport)).rejects.toThrow()
  })

  it('accepts requests with the correct Bearer token', async () => {
    const p = nextPort()
    const httpServer = startMcpStreamableHttpServer('127.0.0.1', p, 'secret-token')
    closers.push(() => httpServer.close())
    await new Promise((r) => setTimeout(r, 100))

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${p}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer secret-token' } },
    })
    await client.connect(transport)
    const result = await client.listTools()
    expect(result.tools.length).toBeGreaterThan(0)
    await client.close()
  })
})
