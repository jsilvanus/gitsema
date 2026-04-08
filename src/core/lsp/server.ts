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
          referencesProvider: true,
          workspaceSymbolProvider: true,
          documentSymbolProvider: true,
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
        }))
        return { jsonrpc: '2.0', id, result: locations }
      }

      // 4. File-level vector search as last resort
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

  if (req.method === 'textDocument/references') {
    const params = req.params ?? {}
    const rawWord = params?.text ?? params?.word ?? ''
    const q = typeof rawWord === 'string' && rawWord.length > 0 ? rawWord : 'symbol'
    try {
      // 1. All symbol definitions with this name (exact + substring) — gives line numbers
      const symbolRows = dbSession.rawDb.prepare(
        `SELECT s.symbol_name, s.symbol_kind, s.start_line, s.end_line, p.path
         FROM symbols s
         JOIN paths p ON s.blob_hash = p.blob_hash
         WHERE LOWER(s.symbol_name) = LOWER(?) OR LOWER(s.symbol_name) LIKE LOWER(?)
         LIMIT 30`,
      ).all(q, `%${q}%`) as Array<{ symbol_name: string; symbol_kind: string; start_line: number; end_line: number; path: string }>

      // 2. FTS5: blobs that textually mention the term — join back to symbols for line numbers
      let ftsLocations: Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> = []
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
            }))
          } else {
            // No symbol-level precision available — fall back to file-level references
            const pathRows = dbSession.rawDb.prepare(
              `SELECT DISTINCT path FROM paths WHERE blob_hash IN (${hashes.map(() => '?').join(',')}) LIMIT 20`,
            ).all(...hashes) as Array<{ path: string }>
            ftsLocations = pathRows.map((r) => ({
              uri: `file://${r.path}`,
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
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
        `SELECT symbol_name, symbol_kind, start_line, end_line
         FROM symbols WHERE blob_hash = ? ORDER BY start_line ASC`,
      ).all(pathRow.blob_hash) as Array<{ symbol_name: string; symbol_kind: string; start_line: number; end_line: number }>

      // Map symbol kinds to LSP SymbolKind numbers
      const kindMap: Record<string, number> = {
        function: 12, method: 6, class: 5, struct: 23, enum: 10,
        trait: 11, impl: 14, other: 13,
      }
      const docSymbols = symbolRows.map((r) => ({
        name: r.symbol_name,
        kind: kindMap[r.symbol_kind] ?? 13,
        range: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.end_line - 1), character: 0 } },
        selectionRange: { start: { line: Math.max(0, r.start_line - 1), character: 0 }, end: { line: Math.max(0, r.start_line - 1), character: 100 } },
      }))
      return { jsonrpc: '2.0', id, result: docSymbols }
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
