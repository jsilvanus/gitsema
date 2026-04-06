import { vectorSearch } from '../search/vectorSearch.js'
import { getActiveSession } from '../db/sqlite.js'
import { embedQuery } from '../embedding/embedQuery.js'
import { buildProvider } from '../embedding/providerFactory.js'
import { createServer as createNetServer } from 'node:net'

export type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string; method: string; params?: any }
export type JsonRpcResponse = { jsonrpc: '2.0'; id?: number | string; result?: any; error?: any }

export function serializeMessage(obj: any): string {
  const body = JSON.stringify(obj)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

export function parseMessage(buffer: Buffer): JsonRpcRequest | null {
  const s = buffer.toString('utf8')
  const parts = s.split('\r\n\r\n')
  if (parts.length < 2) return null
  try {
    const body = parts.slice(1).join('\r\n\r\n')
    const obj = JSON.parse(body) as JsonRpcRequest
    return obj
  } catch (e) {
    return null
  }
}

export async function handleRequest(dbSession: ReturnType<typeof getActiveSession>, req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0', id, result: {
        capabilities: {
          hoverProvider: true,
          definitionProvider: true,
          workspaceSymbolProvider: true,
        },
      },
    }
  }
  if (req.method === 'initialized') {
    return null
  }
  if (req.method === 'shutdown') {
    return { jsonrpc: '2.0', id, result: null }
  }
  if (req.method === 'exit') {
    process.exit(0)
  }

  if (req.method === 'textDocument/hover') {
    const params = req.params ?? {}
    const rawWord = params?.text ?? params?.word ?? ''
    const q = typeof rawWord === 'string' && rawWord.length > 0 ? rawWord : 'symbol'
    try {
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)
      const queryEmb = await embedQuery(provider, q)
      const results = vectorSearch(queryEmb, { topK: 5, model, query: q })
      // Return proper MarkupContent with Markdown hover card
      const lines = results.map((r: any) => {
        const path = r.paths?.[0] ?? r.blobHash
        return `- \`${path}\` — similarity: ${r.score.toFixed(3)}`
      })
      const value = `**Semantic matches for \`${q}\`**\n\n${lines.join('\n')}`
      const contents = { kind: 'markdown', value }
      return { jsonrpc: '2.0', id, result: { contents } }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  if (req.method === 'textDocument/definition') {
    const params = req.params ?? {}
    const rawWord = params?.text ?? params?.word ?? ''
    const q = typeof rawWord === 'string' && rawWord.length > 0 ? rawWord : 'symbol'
    try {
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)
      const queryEmb = await embedQuery(provider, q)
      // Look up symbol definitions from the symbols table first
      const symbolRows = dbSession.rawDb.prepare(
        `SELECT s.symbol_name, s.symbol_kind, s.start_line, s.end_line, p.path
         FROM symbols s
         JOIN paths p ON s.blob_hash = p.blob_hash
         WHERE LOWER(s.symbol_name) LIKE LOWER(?) LIMIT 5`,
      ).all(`%${q}%`) as Array<{ symbol_name: string; symbol_kind: string; start_line: number; end_line: number; path: string }>
      if (symbolRows.length > 0) {
        const locations = symbolRows.map((r) => ({
          uri: `file://${r.path}`,
          range: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.end_line - 1), character: 0 } },
          symbolName: r.symbol_name,
          symbolKind: r.symbol_kind,
        }))
        return { jsonrpc: '2.0', id, result: locations }
      }
      // Fall back to vector search
      const results = vectorSearch(queryEmb, { topK: 3, model, query: q })
      const locations = results.map((r: any) => ({
        uri: `file://${r.paths?.[0] ?? r.blobHash}`,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      }))
      return { jsonrpc: '2.0', id, result: locations }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  if (req.method === 'workspace/symbol') {
    const params = req.params ?? {}
    const query: string = typeof params?.query === 'string' ? params.query : ''
    try {
      const pattern = `%${query}%`
      const symbolRows = dbSession.rawDb.prepare(
        `SELECT s.symbol_name, s.symbol_kind, s.start_line, s.end_line, p.path
         FROM symbols s
         JOIN paths p ON s.blob_hash = p.blob_hash
         WHERE LOWER(s.symbol_name) LIKE LOWER(?) LIMIT 50`,
      ).all(pattern) as Array<{ symbol_name: string; symbol_kind: string; start_line: number; end_line: number; path: string }>
      const symbols = symbolRows.map((r) => ({
        name: r.symbol_name,
        kind: r.symbol_kind,
        location: {
          uri: `file://${r.path}`,
          range: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.end_line - 1), character: 0 } },
        },
      }))
      return { jsonrpc: '2.0', id, result: symbols }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
}

/** Start the LSP server over stdio. */
export function startLspServer(dbSession: ReturnType<typeof getActiveSession>): void {
  const stdin = process.stdin
  stdin.on('data', async (chunk: Buffer) => {
    const req = parseMessage(chunk)
    if (!req) return
    const res = await handleRequest(dbSession, req)
    if (res) {
      const out = serializeMessage(res)
      process.stdout.write(out)
    }
  })
}

/** Start the LSP server over TCP (useful for IDEs that prefer TCP connections). */
export function startLspTcpServer(dbSession: ReturnType<typeof getActiveSession>, port: number): void {
  const server = createNetServer((socket) => {
    socket.on('data', async (chunk: Buffer) => {
      const req = parseMessage(chunk)
      if (!req) return
      const res = await handleRequest(dbSession, req)
      if (res) {
        socket.write(serializeMessage(res))
      }
    })
  })
  server.listen(port, () => {
    process.stderr.write(`LSP server listening on TCP port ${port}\n`)
  })
}

/** Quick sanity check: verify the LSP server can be started (for doctor --lsp). */
export function verifyLspStartup(): { ok: boolean; message: string } {
  try {
    // Just test that the imports and basic structure is available
    const testReq: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
    // Synchronously check serialize/parse round-trip
    const msg = serializeMessage(testReq)
    const parsed = parseMessage(Buffer.from(msg))
    if (!parsed || parsed.method !== 'initialize') {
      return { ok: false, message: 'LSP message round-trip failed' }
    }
    return { ok: true, message: 'LSP server OK' }
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}
