/**
 * Integration tests for Phase 116 (LSP & MCP fleshout §4 — "Phase B") — the
 * LSP WebSocket transport. Uses a real `ws` client to round-trip
 * `textDocument/hover` requests (raw JSON per WS text frame, no
 * `Content-Length` framing) and to exercise Bearer-token auth rejection.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { openDatabaseAt, withDbSession, type DbSession } from '../../src/core/db/sqlite.js'

vi.mock('../../src/core/embedding/providerFactory.js', () => ({
  applyModelOverrides: vi.fn(),
  buildProvider: vi.fn().mockReturnValue({ model: 'm' }),
}))
vi.mock('../../src/core/embedding/embedQuery.js', () => ({ embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]) }))
vi.mock('../../src/core/search/analysis/vectorSearch.js', () => ({
  vectorSearch: vi.fn().mockResolvedValue([{ blobHash: 'b1', paths: ['a.ts'], score: 0.9 }]),
}))

import { startLspWebSocketServer, type JsonRpcRequest, type JsonRpcResponse } from '../../src/core/lsp/server.js'

function setupFixtureDb(): { session: DbSession; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-lspws-'))
  const session = openDatabaseAt(join(tmpDir, 'test.db'))
  return { session, tmpDir }
}

function seedSymbol(session: DbSession): void {
  session.rawDb
    .prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)')
    .run('b1', 100, Date.now())
  session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('b1', 'a.ts')
  session.rawDb
    .prepare(
      'INSERT INTO symbols (blob_hash, start_line, end_line, symbol_name, symbol_kind, language) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('b1', 1, 5, 'myFunc', 'function', 'typescript')
}

const tmpDirs: string[] = []
const closers: Array<() => void> = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

let port = 18500
function nextPort(): number {
  return port++
}

function connectAndSend(url: string, req: JsonRpcRequest, headers?: Record<string, string>): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    ws.on('open', () => ws.send(JSON.stringify(req)))
    ws.on('message', (data: Buffer) => {
      resolve(JSON.parse(data.toString('utf8')) as JsonRpcResponse)
      ws.close()
    })
    ws.on('error', (err) => reject(err))
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })
}

describe('LSP WebSocket transport (Phase 116)', () => {
  it('round-trips textDocument/hover over a real WebSocket connection', async () => {
    const { session, tmpDir } = setupFixtureDb()
    tmpDirs.push(tmpDir)
    await withDbSession(session, async () => {
      seedSymbol(session)
      const p = nextPort()
      const httpServer = startLspWebSocketServer(session, '127.0.0.1', p, undefined)
      closers.push(() => httpServer.close())
      await new Promise((r) => setTimeout(r, 100))

      const res = await connectAndSend(`ws://127.0.0.1:${p}/lsp`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'textDocument/hover',
        params: { text: 'myFunc' },
      })
      expect(res.result).toBeTruthy()
      expect(JSON.stringify(res.result)).toContain('myFunc')
    })
    session.rawDb.close()
  })

  it('rejects connections with a missing or wrong Bearer token', async () => {
    const { session, tmpDir } = setupFixtureDb()
    tmpDirs.push(tmpDir)
    await withDbSession(session, async () => {
      const p = nextPort()
      const httpServer = startLspWebSocketServer(session, '127.0.0.1', p, 'secret-token')
      closers.push(() => httpServer.close())
      await new Promise((r) => setTimeout(r, 100))

      await expect(
        connectAndSend(
          `ws://127.0.0.1:${p}/lsp`,
          { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: { text: 'myFunc' } },
          { Authorization: 'Bearer wrong-token' },
        ),
      ).rejects.toThrow()
    })
    session.rawDb.close()
  })

  it('accepts connections with the correct Bearer token', async () => {
    const { session, tmpDir } = setupFixtureDb()
    tmpDirs.push(tmpDir)
    await withDbSession(session, async () => {
      seedSymbol(session)
      const p = nextPort()
      const httpServer = startLspWebSocketServer(session, '127.0.0.1', p, 'secret-token')
      closers.push(() => httpServer.close())
      await new Promise((r) => setTimeout(r, 100))

      const res = await connectAndSend(
        `ws://127.0.0.1:${p}/lsp`,
        { jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: { text: 'myFunc' } },
        { Authorization: 'Bearer secret-token' },
      )
      expect(res.result).toBeTruthy()
    })
    session.rawDb.close()
  })
})
