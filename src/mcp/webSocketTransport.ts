/**
 * Phase 116 (LSP & MCP fleshout §4 — "Phase B") — minimal MCP `Transport`
 * implementation over a `ws` WebSocket connection. The SDK ships
 * `StdioServerTransport`/`StreamableHTTPServerTransport` but no plain
 * WebSocket transport, so this mirrors `StdioServerTransport`'s shape
 * (`start()`/`send()`/`close()` + `onmessage`/`onerror`/`onclose`) per the
 * spec's "implement a minimal Transport per the SDK's Transport interface"
 * guidance.
 */

import type { WebSocket } from 'ws'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

export class WebSocketServerTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(private readonly socket: WebSocket) {}

  async start(): Promise<void> {
    this.socket.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString('utf8')) as JSONRPCMessage
        this.onmessage?.(message)
      } catch (err: unknown) {
        this.onerror?.(err instanceof Error ? err : new Error(String(err)))
      }
    })
    this.socket.on('close', () => this.onclose?.())
    this.socket.on('error', (err: Error) => this.onerror?.(err))
  }

  async send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.send(JSON.stringify(message), (err) => (err ? reject(err) : resolve()))
    })
  }

  async close(): Promise<void> {
    this.socket.close()
  }
}
