import { vectorSearch } from '../search/vectorSearch.js'
import { getActiveSession } from '../db/sqlite.js'
import { embedQuery } from '../embedding/embedQuery.js'

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
    return { jsonrpc: '2.0', id, result: { capabilities: { hoverProvider: true } } }
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
    // Extract the hovered word: prefer explicit text/word params over position-based lookup
    const rawWord = params?.text ?? params?.word ?? ''
    const q = typeof rawWord === 'string' && rawWord.length > 0 ? rawWord : 'symbol'
    // Use a lightweight embedding flow: embed the query then vectorSearch
    try {
      const provider = { model: 'mock' }
      const queryEmb = await embedQuery(provider as any, q)
      const results = vectorSearch(queryEmb, { topK: 5, model: undefined, query: q })
      // Build hover contents from top results
      const contents = results.map((r: any) => `${r.blobHash} ${r.score.toFixed(3)} ${((r.paths && r.paths[0]) || '')}`).join('\n')
      return { jsonrpc: '2.0', id, result: { contents } }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: String(e) } }
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
}

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
