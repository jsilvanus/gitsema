/**
 * Integration tests for Phase 116 (LSP & MCP fleshout §4 — "Phase B") — the
 * MCP WebSocket transport. Uses a real `ws` client (not the SDK's bundled
 * `WebSocketClientTransport`, which relies on the global `WebSocket` and
 * can't set the `Authorization` header needed to exercise auth) wrapped in
 * a minimal client-side `Transport`, paired with the real SDK `Client`.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { startMcpWebSocketServer } from '../../src/mcp/webSocketServer.js'

class TestClientTransport implements Transport {
  private socket?: WebSocket
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(
    private readonly url: string,
    private readonly headers?: Record<string, string>,
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url, { headers: this.headers })
      this.socket = socket
      socket.on('open', () => resolve())
      socket.on('error', (err: Error) => {
        this.onerror?.(err)
        reject(err)
      })
      socket.on('message', (data: Buffer) => {
        this.onmessage?.(JSON.parse(data.toString('utf8')) as JSONRPCMessage)
      })
      socket.on('close', () => this.onclose?.())
    })
  }

  async send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket!.send(JSON.stringify(message), (err) => (err ? reject(err) : resolve()))
    })
  }

  async close(): Promise<void> {
    this.socket?.close()
  }
}

let port = 18400
function nextPort(): number {
  return port++
}

const closers: Array<() => void> = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('MCP WebSocket transport (Phase 116)', () => {
  it('round-trips tools/list over a real WebSocket connection', async () => {
    const p = nextPort()
    const httpServer = startMcpWebSocketServer('127.0.0.1', p, undefined)
    closers.push(() => httpServer.close())
    await new Promise((r) => setTimeout(r, 100))

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new TestClientTransport(`ws://127.0.0.1:${p}/mcp`)
    await client.connect(transport)

    const result = await client.listTools()
    expect(Array.isArray(result.tools)).toBe(true)
    expect(result.tools.length).toBeGreaterThan(0)
    expect(result.tools.some((t) => t.name === 'semantic_search')).toBe(true)

    await client.close()
  })

  it('rejects connections with a missing or wrong Bearer token', async () => {
    const p = nextPort()
    const httpServer = startMcpWebSocketServer('127.0.0.1', p, 'secret-token')
    closers.push(() => httpServer.close())
    await new Promise((r) => setTimeout(r, 100))

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new TestClientTransport(`ws://127.0.0.1:${p}/mcp`, { Authorization: 'Bearer wrong-token' })
    await expect(client.connect(transport)).rejects.toThrow()
  })

  it('accepts connections with the correct Bearer token', async () => {
    const p = nextPort()
    const httpServer = startMcpWebSocketServer('127.0.0.1', p, 'secret-token')
    closers.push(() => httpServer.close())
    await new Promise((r) => setTimeout(r, 100))

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new TestClientTransport(`ws://127.0.0.1:${p}/mcp`, { Authorization: 'Bearer secret-token' })
    await client.connect(transport)
    const result = await client.listTools()
    expect(result.tools.length).toBeGreaterThan(0)
    await client.close()
  })
})
