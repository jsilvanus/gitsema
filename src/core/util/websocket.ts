/**
 * Phase 116 (LSP & MCP fleshout §4 — "Phase B") — shared helpers for the LSP
 * and MCP WebSocket transports: bind-address parsing and Bearer-token auth
 * on the WS upgrade request (mirrors `authMiddleware`'s `Authorization:
 * Bearer <token>` convention, applied here to a raw `http.IncomingMessage`
 * since the WS servers don't run through Express).
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Default `maxPayload` (bytes) for the raw `WebSocketServer` transports (review10 §3.1) — `ws`'s own default is effectively unbounded. */
export const DEFAULT_MAX_WS_PAYLOAD = 10 * 1024 * 1024

/** Default cap on concurrent connections/sessions for the raw network transports (review10 §3.2). */
export const DEFAULT_MAX_CONNECTIONS = 100

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** True for hosts that are not reachable from outside the local machine. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

/**
 * Warns loudly on stderr when a network transport binds a non-loopback address
 * with no Bearer key configured — without one, `checkBearerAuth()` allows every
 * connection (review10 §3.3).
 */
export function warnIfNonLoopbackWithoutKey(host: string, key: string | undefined, transportLabel: string): void {
  if (!key && !isLoopbackHost(host)) {
    process.stderr.write(
      `Warning: ${transportLabel} is bound to "${host}" (not loopback) with no --key set — this exposes the full capability surface to anyone who can reach this address. Pass --key (or set the matching GITSEMA_*_KEY env var) to require a Bearer token.\n`,
    )
  }
}

/** Tracks concurrent connections and rejects new ones past `max` (review10 §3.2). */
export class ConnectionLimiter {
  private count = 0
  constructor(private readonly max: number) {}

  /** Returns true and reserves a slot if under the cap; false if the cap is reached. */
  tryAcquire(): boolean {
    if (this.count >= this.max) return false
    this.count++
    return true
  }

  release(): void {
    if (this.count > 0) this.count--
  }
}

/** Parses a size spec like `"1mb"`, `"500kb"`, or a plain byte count into bytes. */
export function parseSizeToBytes(spec: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b)?$/i.exec(spec.trim())
  if (!match) throw new Error(`Invalid size spec "${spec}": expected e.g. "1mb", "500kb", or a byte count`)
  const value = parseFloat(match[1])
  const unit = (match[2] ?? 'b').toLowerCase()
  const multiplier = unit === 'gb' ? 1024 * 1024 * 1024 : unit === 'mb' ? 1024 * 1024 : unit === 'kb' ? 1024 : 1
  return Math.round(value * multiplier)
}

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
