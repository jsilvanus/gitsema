/**
 * Phase 116 (LSP & MCP fleshout §4 — "Phase B") — shared helpers for the LSP
 * and MCP WebSocket transports: bind-address parsing and Bearer-token auth
 * on the WS upgrade request (mirrors `authMiddleware`'s `Authorization:
 * Bearer <token>` convention, applied here to a raw `http.IncomingMessage`
 * since the WS servers don't run through Express).
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Parses a `host:port` bind address (e.g. `0.0.0.0:4242`, `localhost:8080`). */
export function parseBindAddress(addr: string): { host: string; port: number } {
  const idx = addr.lastIndexOf(':')
  if (idx === -1) {
    throw new Error(`Invalid bind address "${addr}": expected "host:port"`)
  }
  const host = addr.slice(0, idx)
  const port = parseInt(addr.slice(idx + 1), 10)
  if (!host || isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid bind address "${addr}": expected "host:port" with a valid port (1-65535)`)
  }
  return { host, port }
}

/**
 * Checks the `Authorization: Bearer <token>` header on a WS upgrade request
 * against `key`. No-op (always allowed) when `key` is undefined/empty —
 * matches `authMiddleware`'s "unset key means no auth" behavior.
 */
export function checkBearerAuth(req: IncomingMessage, key: string | undefined): boolean {
  if (!key) return true
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) return false
  const provided = header.slice('Bearer '.length)
  const a = Buffer.from(provided)
  const b = Buffer.from(key)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
