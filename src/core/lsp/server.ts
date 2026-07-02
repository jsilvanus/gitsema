import { vectorSearch } from '../search/analysis/vectorSearch.js'
import { getActiveSession } from '../db/sqlite.js'
import { embedQuery } from '../embedding/embedQuery.js'
import { buildProvider } from '../embedding/providerFactory.js'
import { createServer as createHttpServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { checkBearerAuth, DEFAULT_MAX_WS_PAYLOAD, DEFAULT_MAX_CONNECTIONS, ConnectionLimiter } from '../util/websocket.js'
import { callRemote, type RemoteConfig } from '../remote/protocolClient.js'
import {
  activeGraphStore,
  isGraphBuilt,
  structuralDefinition,
  structuralReferences,
  prepareCallHierarchy,
  incomingCalls,
  outgoingCalls,
} from './structuralNav.js'
import { buildHoverMarkdown } from './hoverContent.js'
import { startBackgroundRefresh, getAnalysisCache, type DiagnosticItem } from './analysisCache.js'
import { callers } from '../graph/traversal.js'

/** Maps JSON-RPC methods that need DB access to the `lsp.<op>` name used by `protocolClient.ts`. */
const METHOD_TO_REMOTE_OP: Record<string, string> = {
  'textDocument/hover': 'lsp.hover',
  'textDocument/definition': 'lsp.definition',
  'textDocument/references': 'lsp.references',
  'textDocument/documentSymbol': 'lsp.documentSymbol',
  'workspace/symbol': 'lsp.workspaceSymbol',
  'textDocument/prepareCallHierarchy': 'lsp.prepareCallHierarchy',
  'callHierarchy/incomingCalls': 'lsp.incomingCalls',
  'callHierarchy/outgoingCalls': 'lsp.outgoingCalls',
  'textDocument/codeLens': 'lsp.codeLens',
}

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

export async function handleRequest(
  dbSession: ReturnType<typeof getActiveSession>,
  req: JsonRpcRequest,
  remote?: RemoteConfig,
): Promise<JsonRpcResponse | null> {
  const id = req.id

  // Phase 113: data-needing methods delegate to a remote `gitsema tools serve`
  // instance when --remote is set; protocol-level methods below (initialize,
  // shutdown, etc.) always run locally — there's nothing to delegate.
  if (remote) {
    const op = METHOD_TO_REMOTE_OP[req.method]
    if (op) {
      try {
        const result = await callRemote(op, req.params, remote)
        return { jsonrpc: '2.0', id, result }
      } catch (e: any) {
        return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e?.message ?? e) } }
      }
    }
  }

  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0', id, result: {
        capabilities: {
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          workspaceSymbolProvider: true,
          documentSymbolProvider: true,
          callHierarchyProvider: true,
          codeLensProvider: true,
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
      const results = await vectorSearch(queryEmb, { topK: 5, model, query: q })
      const semanticLines = results.map((r: any) => {
        const path = r.paths?.[0] ?? r.blobHash
        return `- \`${path}\` — similarity: ${r.score.toFixed(3)}`
      })

      // Phase 115 (§6.1): enrich with optional Temporal/Risk/Structure
      // sections, joined onto the existing semantic result via the symbol's
      // own (blobHash, path) identity — never blocks hover on missing data.
      const symbolRow = dbSession.rawDb.prepare(
        `SELECT s.blob_hash, p.path FROM symbols s
         JOIN paths p ON s.blob_hash = p.blob_hash
         WHERE LOWER(s.symbol_name) = LOWER(?) LIMIT 1`,
      ).get(q) as { blob_hash: string; path: string } | undefined

      const value = await buildHoverMarkdown({
        query: q,
        semanticLines,
        blobHash: symbolRow?.blob_hash,
        path: symbolRow?.path,
      })
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
      // Phase 114 (§5.3): structural resolution first, exact and unambiguous.
      // Semantic search below only runs when the graph isn't built, the
      // identifier doesn't resolve, or it resolves to a node with no
      // location (e.g. external) — never merged into one ranked list.
      const graph = activeGraphStore()
      if (await isGraphBuilt(graph)) {
        const structural = await structuralDefinition(graph, q)
        if (structural.length > 0) {
          return { jsonrpc: '2.0', id, result: structural }
        }
      }

      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)

      // 1. Exact name match (highest precision)
      let symbolRows = dbSession.rawDb.prepare(
        `SELECT s.symbol_name, s.symbol_kind, s.start_line, s.end_line, p.path
         FROM symbols s
         JOIN paths p ON s.blob_hash = p.blob_hash
         WHERE LOWER(s.symbol_name) = LOWER(?) LIMIT 5`,
      ).all(q) as Array<{ symbol_name: string; symbol_kind: string; start_line: number; end_line: number; path: string }>

      // 2. Substring match fallback
      if (symbolRows.length === 0) {
        symbolRows = dbSession.rawDb.prepare(
          `SELECT s.symbol_name, s.symbol_kind, s.start_line, s.end_line, p.path
           FROM symbols s
           JOIN paths p ON s.blob_hash = p.blob_hash
           WHERE LOWER(s.symbol_name) LIKE LOWER(?) LIMIT 5`,
        ).all(`%${q}%`) as typeof symbolRows
      }

      if (symbolRows.length > 0) {
        const locations = symbolRows.map((r) => ({
          uri: `file://${r.path}`,
          range: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.end_line - 1), character: 0 } },
          symbolName: r.symbol_name,
          symbolKind: r.symbol_kind,
          tags: ['fallback'],
        }))
        return { jsonrpc: '2.0', id, result: locations }
      }

      // 3. Semantic fallback: search symbol embeddings by vector similarity
      const queryEmb = await embedQuery(provider, q)
      const symEmbRows = dbSession.rawDb.prepare(
        `SELECT se.symbol_id, s.symbol_name, s.symbol_kind, s.start_line, s.end_line,
                p.path, se.vector
         FROM symbol_embeddings se
         JOIN symbols s ON se.symbol_id = s.id
         JOIN paths p ON s.blob_hash = p.blob_hash
         WHERE se.model = ? LIMIT 2000`,
      ).all(model) as Array<{ symbol_id: number; symbol_name: string; symbol_kind: string; start_line: number; end_line: number; path: string; vector: Buffer }>

      if (symEmbRows.length > 0) {
        const qArr = new Float32Array(queryEmb)
        const qNorm = Math.sqrt(qArr.reduce((s, v) => s + v * v, 0)) || 1
        const scored = symEmbRows.map((r) => {
          const vec = new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4)
          const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0)) || 1
          let dot = 0
          for (let i = 0; i < qArr.length && i < vec.length; i++) dot += qArr[i] * vec[i]
          return { ...r, score: dot / (qNorm * norm) }
        }).sort((a, b) => b.score - a.score).slice(0, 3)

        const locations = scored.map((r) => ({
          uri: `file://${r.path}`,
          range: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.end_line - 1), character: 0 } },
          symbolName: r.symbol_name,
          symbolKind: r.symbol_kind,
          tags: ['fallback'],
        }))
        return { jsonrpc: '2.0', id, result: locations }
      }

      // 4. File-level vector search as last resort
      const results = await vectorSearch(queryEmb, { topK: 3, model, query: q })
      const locations = results.map((r: any) => ({
        uri: `file://${r.paths?.[0] ?? r.blobHash}`,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        tags: ['fallback'],
      }))
      return { jsonrpc: '2.0', id, result: locations }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  if (req.method === 'textDocument/references') {
    const params = req.params ?? {}
    const rawWord = params?.text ?? params?.word ?? ''
    const q = typeof rawWord === 'string' && rawWord.length > 0 ? rawWord : 'symbol'
    try {
      // Phase 114 (§5.3): structural resolution first, exact and unambiguous.
      const graph = activeGraphStore()
      if (await isGraphBuilt(graph)) {
        const structural = await structuralReferences(graph, q)
        if (structural.length > 0) {
          return { jsonrpc: '2.0', id, result: structural }
        }
      }

      // 1. All symbol definitions with this name (exact + substring) — gives line numbers
      const symbolRows = dbSession.rawDb.prepare(
        `SELECT s.symbol_name, s.symbol_kind, s.start_line, s.end_line, p.path
         FROM symbols s
         JOIN paths p ON s.blob_hash = p.blob_hash
         WHERE LOWER(s.symbol_name) = LOWER(?) OR LOWER(s.symbol_name) LIKE LOWER(?)
         LIMIT 30`,
      ).all(q, `%${q}%`) as Array<{ symbol_name: string; symbol_kind: string; start_line: number; end_line: number; path: string }>

      // 2. FTS5: blobs that textually mention the term — join back to symbols for line numbers
      let ftsLocations: Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; tags: string[] }> = []
      try {
        const ftsRows = dbSession.rawDb.prepare(
          `SELECT blob_hash FROM blob_fts WHERE blob_fts MATCH ? LIMIT 20`,
        ).all(`"${q.replace(/"/g, '""')}"`) as Array<{ blob_hash: string }>

        if (ftsRows.length > 0) {
          const hashes = ftsRows.map((r) => r.blob_hash)
          // Try to get line-level positions from symbol index for these blobs
          const symInBlobs = dbSession.rawDb.prepare(
            `SELECT s.symbol_name, s.start_line, s.end_line, p.path
             FROM symbols s
             JOIN paths p ON s.blob_hash = p.blob_hash
             WHERE s.blob_hash IN (${hashes.map(() => '?').join(',')})
               AND LOWER(s.symbol_name) LIKE LOWER(?)
             LIMIT 30`,
          ).all(...hashes, `%${q}%`) as Array<{ symbol_name: string; start_line: number; end_line: number; path: string }>

          if (symInBlobs.length > 0) {
            ftsLocations = symInBlobs.map((r) => ({
              uri: `file://${r.path}`,
              range: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.end_line - 1), character: 0 } },
              tags: ['fallback'],
            }))
          } else {
            // No symbol-level precision available — fall back to file-level references
            const pathRows = dbSession.rawDb.prepare(
              `SELECT DISTINCT path FROM paths WHERE blob_hash IN (${hashes.map(() => '?').join(',')}) LIMIT 20`,
            ).all(...hashes) as Array<{ path: string }>
            ftsLocations = pathRows.map((r) => ({
              uri: `file://${r.path}`,
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              tags: ['fallback'],
            }))
          }
        }
      } catch {
        // FTS not available
      }

      // Merge: symbol definitions first, then FTS-derived locations, deduplicated by uri+line
      const seen = new Set<string>()
      const locations = [...symbolRows.map((r) => ({
        uri: `file://${r.path}`,
        range: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.end_line - 1), character: 0 } },
        tags: ['fallback'],
      })), ...ftsLocations].filter((loc) => {
        const key = `${loc.uri}:${loc.range.start.line}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      return { jsonrpc: '2.0', id, result: locations }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  if (req.method === 'textDocument/documentSymbol') {
    const params = req.params ?? {}
    const uri: string = typeof params?.textDocument?.uri === 'string' ? params.textDocument.uri
      : typeof params?.uri === 'string' ? params.uri : ''
    try {
      // Resolve file path from URI (strip file://)
      const filePath = uri.replace(/^file:\/\//, '')
      if (!filePath) return { jsonrpc: '2.0', id, result: [] }

      // Look up blob_hash(es) for this path, prefer most recent
      const pathRow = dbSession.rawDb.prepare(
        `SELECT p.blob_hash FROM paths p
         JOIN blob_commits bc ON p.blob_hash = bc.blob_hash
         JOIN commits c ON bc.commit_hash = c.commit_hash
         WHERE p.path = ? OR p.path LIKE ?
         ORDER BY c.timestamp DESC LIMIT 1`,
      ).get(filePath, `%${filePath}`) as { blob_hash: string } | undefined

      if (!pathRow) return { jsonrpc: '2.0', id, result: [] }

      const symbolRows = dbSession.rawDb.prepare(
        `SELECT symbol_name, symbol_kind, start_line, end_line, qualified_name, signature
         FROM symbols WHERE blob_hash = ? ORDER BY start_line ASC`,
      ).all(pathRow.blob_hash) as Array<{ symbol_name: string; symbol_kind: string; start_line: number; end_line: number; qualified_name: string | null; signature: string | null }>

      // Map symbol kinds to LSP SymbolKind numbers
      const kindMap: Record<string, number> = {
        function: 12, method: 6, class: 5, struct: 23, enum: 10,
        trait: 11, impl: 14, other: 13,
      }
      const docSymbols = symbolRows.map((r) => {
        const name = r.qualified_name ?? r.symbol_name
        return {
          name: r.signature ? `${name}${r.signature}` : name,
          kind: kindMap[r.symbol_kind] ?? 13,
          range: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.end_line - 1), character: 0 } },
          selectionRange: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.start_line - 1), character: 100 } },
        }
      })
      return { jsonrpc: '2.0', id, result: docSymbols }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  if (req.method === 'textDocument/codeLens') {
    const params = req.params ?? {}
    const uri: string = typeof params?.textDocument?.uri === 'string' ? params.textDocument.uri
      : typeof params?.uri === 'string' ? params.uri : ''
    try {
      const filePath = uri.replace(/^file:\/\//, '')
      if (!filePath) return { jsonrpc: '2.0', id, result: [] }

      const pathRow = dbSession.rawDb.prepare(
        `SELECT p.blob_hash FROM paths p
         JOIN blob_commits bc ON p.blob_hash = bc.blob_hash
         JOIN commits c ON bc.commit_hash = c.commit_hash
         WHERE p.path = ? OR p.path LIKE ?
         ORDER BY c.timestamp DESC LIMIT 1`,
      ).get(filePath, `%${filePath}`) as { blob_hash: string } | undefined
      if (!pathRow) return { jsonrpc: '2.0', id, result: [] }

      const symbolRows = dbSession.rawDb.prepare(
        `SELECT symbol_name, qualified_name, start_line FROM symbols WHERE blob_hash = ? ORDER BY start_line ASC`,
      ).all(pathRow.blob_hash) as Array<{ symbol_name: string; qualified_name: string | null; start_line: number }>

      // Phase 115 (§6.3): "Called N times · Last touched <date>" per symbol —
      // call counts from the structural graph (if built), last-touched from
      // the cached analysis pass; both omitted gracefully when unavailable.
      const graph = activeGraphStore()
      const graphBuilt = await isGraphBuilt(graph)
      const cache = getAnalysisCache()

      const lenses = []
      for (const r of symbolRows) {
        const identifier = r.qualified_name ?? r.symbol_name
        const parts: string[] = []
        if (graphBuilt) {
          const result = await callers(graph, identifier, 1)
          if (result.resolved.status === 'found') parts.push(`Called ${result.hits.length}×`)
        }
        const debt = cache?.debtByPath.get(filePath)
        if (debt) parts.push(`debt ${debt.debtScore.toFixed(2)}`)
        if (parts.length === 0) continue
        const line = Math.max(0, r.start_line - 1)
        lenses.push({
          range: { start: { line, character: 0 }, end: { line, character: 0 } },
          command: { title: parts.join(' · '), command: '' },
        })
      }
      return { jsonrpc: '2.0', id, result: lenses }
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

  if (req.method === 'textDocument/prepareCallHierarchy') {
    const params = req.params ?? {}
    const rawWord = params?.text ?? params?.word ?? ''
    const q = typeof rawWord === 'string' && rawWord.length > 0 ? rawWord : 'symbol'
    try {
      const graph = activeGraphStore()
      const items = await prepareCallHierarchy(graph, q)
      return { jsonrpc: '2.0', id, result: items }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  if (req.method === 'callHierarchy/incomingCalls') {
    const params = req.params ?? {}
    const rawWord = params?.item?.data ?? params?.text ?? params?.word ?? ''
    const q = typeof rawWord === 'string' && rawWord.length > 0 ? rawWord : 'symbol'
    try {
      const graph = activeGraphStore()
      const calls = await incomingCalls(graph, q)
      return { jsonrpc: '2.0', id, result: calls }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  if (req.method === 'callHierarchy/outgoingCalls') {
    const params = req.params ?? {}
    const rawWord = params?.item?.data ?? params?.text ?? params?.word ?? ''
    const q = typeof rawWord === 'string' && rawWord.length > 0 ? rawWord : 'symbol'
    try {
      const graph = activeGraphStore()
      const calls = await outgoingCalls(graph, q)
      return { jsonrpc: '2.0', id, result: calls }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
}

export interface LspServerOptions {
  /** Phase 115 (§6.2): opt-in background diagnostics (default off — see false-positive-rate note in PLAN.md). */
  diagnostics?: boolean
  /** Refresh interval for the diagnostics cache, in ms. Default 5 minutes. */
  diagnosticsIntervalMs?: number
}

const DEFAULT_DIAGNOSTICS_INTERVAL_MS = 5 * 60 * 1000

function buildDiagnosticsNotification(path: string, items: DiagnosticItem[]): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri: `file://${path}`,
      diagnostics: items.map(({ severity, message, range }) => ({ severity, message, range, source: 'gitsema' })),
    },
  } as any
}

/**
 * Starts the diagnostics background refresh loop and returns a callback that
 * pushes a `textDocument/publishDiagnostics` notification (via `write`) for
 * every flagged path on each refresh cycle. No-op (returns `null`) when
 * `--diagnostics` wasn't requested or a `remote` is set — diagnostics push
 * notifications, which Phase 113's request/response remote mechanism doesn't
 * support, so this degrades to "disabled" rather than attempting it remotely.
 */
function maybeStartDiagnostics(
  dbSession: ReturnType<typeof getActiveSession>,
  options: LspServerOptions | undefined,
  remote: RemoteConfig | undefined,
  publish: (message: JsonRpcResponse) => void,
): ReturnType<typeof setInterval> | null {
  if (!options?.diagnostics || remote) return null
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProvider(providerType, model)
  const intervalMs = options.diagnosticsIntervalMs ?? DEFAULT_DIAGNOSTICS_INTERVAL_MS
  return startBackgroundRefresh(dbSession, provider, intervalMs, (diagnosticsByPath) => {
    for (const [path, items] of diagnosticsByPath) {
      publish(buildDiagnosticsNotification(path, items))
    }
  })
}

/** Start the LSP server over stdio. */
export function startLspServer(
  dbSession: ReturnType<typeof getActiveSession>,
  remote?: RemoteConfig,
  options?: LspServerOptions,
): void {
  const stdin = process.stdin
  stdin.on('data', async (chunk: Buffer) => {
    const req = parseMessage(chunk)
    if (!req) return
    const res = await handleRequest(dbSession, req, remote)
    if (res) {
      const out = serializeMessage(res)
      process.stdout.write(out)
    }
  })
  maybeStartDiagnostics(dbSession, options, remote, (message) => process.stdout.write(serializeMessage(message)))
}

/**
 * Start the LSP server over WebSocket, on a fixed `/lsp` path (Phase 116).
 * Unlike stdio, messages are raw JSON per WS text frame (no `Content-Length`
 * framing). Unlike `--remote` delegation, WebSocket supports server push, so
 * `--diagnostics` works normally here.
 */
export function startLspWebSocketServer(
  dbSession: ReturnType<typeof getActiveSession>,
  host: string,
  port: number,
  authKey: string | undefined,
  remote?: RemoteConfig,
  options?: LspServerOptions,
): import('node:http').Server {
  const sockets = new Set<WebSocket>()
  const httpServer = createHttpServer()
  const wss = new WebSocketServer({ noServer: true, maxPayload: DEFAULT_MAX_WS_PAYLOAD })
  const limiter = new ConnectionLimiter(DEFAULT_MAX_CONNECTIONS)

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''
    const path = url.split('?')[0]
    if (path !== '/lsp' || !checkBearerAuth(req, authKey)) {
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
    sockets.add(ws)
    ws.on('close', () => {
      sockets.delete(ws)
      limiter.release()
    })
    ws.on('message', async (data: Buffer) => {
      let req: JsonRpcRequest
      try {
        req = JSON.parse(data.toString('utf8')) as JsonRpcRequest
      } catch {
        return
      }
      const res = await handleRequest(dbSession, req, remote)
      if (res) {
        ws.send(JSON.stringify(res))
      }
    })
  })

  httpServer.listen(port, host, () => {
    process.stderr.write(`LSP server listening on ws://${host}:${port}/lsp\n`)
  })

  maybeStartDiagnostics(dbSession, options, remote, (message) => {
    const payload = JSON.stringify(message)
    for (const ws of sockets) ws.send(payload)
  })

  return httpServer
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
