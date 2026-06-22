/**
 * Phase 117 — MCP server over the SDK's Streamable HTTP transport, on a
 * fixed `/mcp` path. Unlike the WebSocket transport (Phase 116), a session
 * here spans many HTTP requests: `Protocol.connect()` is called once per
 * *session* (at `initialize` time), and the same `McpServer`+transport pair
 * then handles every subsequent POST/GET/DELETE for that session via
 * `transport.handleRequest()`. A session map tracks live sessions so
 * follow-up requests can be routed to the transport that owns them.
 */

import { randomUUID } from 'node:crypto'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildMcpServer } from './server.js'
import { checkBearerAuth } from '../core/util/websocket.js'

function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
}

export function startMcpStreamableHttpServer(host: string, port: number, authKey: string | undefined): Server {
  const sessions = new Map<string, StreamableHTTPServerTransport>()

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    if (!checkBearerAuth(req, authKey)) {
      res.writeHead(401).end()
      return
    }

    const sessionIdHeader = req.headers['mcp-session-id']
    const sessionId = typeof sessionIdHeader === 'string' ? sessionIdHeader : undefined

    if (sessionId) {
      const transport = sessions.get(sessionId)
      if (!transport) {
        sendJsonRpcError(res, 404, -32001, 'Session not found')
        return
      }
      await transport.handleRequest(req, res)
      return
    }

    if (req.method !== 'POST') {
      sendJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided')
      return
    }

    // No session ID: must be an `initialize` request starting a new session.
    const server = buildMcpServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport)
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid)
      },
    })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  }

  const httpServer = createHttpServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`MCP Streamable HTTP request error: ${msg}\n`)
      if (!res.headersSent) sendJsonRpcError(res, 500, -32603, 'Internal error')
    })
  })

  httpServer.listen(port, host, () => {
    process.stderr.write(`MCP server listening on http://${host}:${port}/mcp (Streamable HTTP)\n`)
  })

  return httpServer
}
