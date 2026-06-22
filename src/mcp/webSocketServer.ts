/**
 * Phase 116 (LSP & MCP fleshout §4 — "Phase B") — MCP server over WebSocket,
 * on a fixed `/mcp` path. Each connection gets its own freshly-built
 * `McpServer` (via `buildMcpServer()`), since the SDK's `Protocol.connect()`
 * throws if called twice on the same instance — unlike the single shared
 * stdio server, this transport can serve multiple concurrent clients.
 */

import { createServer as createHttpServer, type Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { buildMcpServer } from './server.js'
import { WebSocketServerTransport } from './webSocketTransport.js'
import { checkBearerAuth, DEFAULT_MAX_WS_PAYLOAD, DEFAULT_MAX_CONNECTIONS, ConnectionLimiter } from '../core/util/websocket.js'

/** Matches the subprotocol the SDK's own `WebSocketClientTransport` requests, for interop. */
const MCP_SUBPROTOCOL = 'mcp'

export function startMcpWebSocketServer(host: string, port: number, authKey: string | undefined): Server {
  const httpServer = createHttpServer()
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: () => MCP_SUBPROTOCOL,
    maxPayload: DEFAULT_MAX_WS_PAYLOAD,
  })
  const limiter = new ConnectionLimiter(DEFAULT_MAX_CONNECTIONS)

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''
    const path = url.split('?')[0]
    if (path !== '/mcp' || !checkBearerAuth(req, authKey)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    if (!limiter.tryAcquire()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws: WebSocket) => {
    ws.on('close', () => limiter.release())
    const server = buildMcpServer()
    const transport = new WebSocketServerTransport(ws)
    void server.connect(transport)
  })

  httpServer.listen(port, host, () => {
    process.stderr.write(`MCP server listening on ws://${host}:${port}/mcp\n`)
  })

  return httpServer
}
