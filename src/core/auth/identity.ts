/**
 * Identity & credentials core (Phase 122 / multi-tenant-auth §5 Phase A).
 *
 * A user authenticates via one of: password + session, or a long-lived API
 * key. Both resolve to the same `users.id` before any authorization check
 * runs (authorization itself — repo_grants, orgs — ships in Phase 123).
 *
 * Passwords are hashed with node:crypto's built-in scrypt (no new
 * dependency, consistent with the project's minimal-deps posture). Session
 * tokens and API keys are stored as SHA-256 hashes at rest, the same
 * precedent set for repo_tokens (review7 §4.1) — only a prefix is kept in
 * the clear for display/revoke-by-prefix lookups.
 */

import type Database from 'better-sqlite3'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

const SCRYPT_KEYLEN = 64
const DEFAULT_SESSION_TTL_DAYS = 30

export interface User {
  id: number
  username: string
  createdAt: number
}

export interface SessionInfo {
  userId: number
  expiresAt: number
}

export interface ApiKeyInfo {
  keyPrefix: string
  userId: number
  label: string | null
  createdAt: number
  expiresAt: number | null
  revokedAt: number | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
}

function sessionTtlSeconds(): number {
  const days = Number(process.env.GITSEMA_SESSION_TTL_DAYS ?? DEFAULT_SESSION_TTL_DAYS)
  const safeDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_SESSION_TTL_DAYS
  return safeDays * 86400
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username '${username}' is already taken`)
  }
}

/** Creates a new user with a scrypt-hashed password. Throws UsernameTakenError on collision. */
export function createUser(rawDb: InstanceType<typeof Database>, username: string, password: string): User {
  const existing = rawDb.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) throw new UsernameTakenError(username)

  const salt = randomBytes(16).toString('hex')
  const passwordHash = hashPassword(password, salt)
  const createdAt = Math.floor(Date.now() / 1000)
  const result = rawDb
    .prepare('INSERT INTO users (username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)')
    .run(username, passwordHash, salt, createdAt)
  return { id: Number(result.lastInsertRowid), username, createdAt }
}

export function getUserByUsername(rawDb: InstanceType<typeof Database>, username: string): User | undefined {
  const row = rawDb
    .prepare('SELECT id, username, created_at FROM users WHERE username = ?')
    .get(username) as { id: number; username: string; created_at: number } | undefined
  return row ? { id: row.id, username: row.username, createdAt: row.created_at } : undefined
}

export function getUserById(rawDb: InstanceType<typeof Database>, userId: number): User | undefined {
  const row = rawDb
    .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
    .get(userId) as { id: number; username: string; created_at: number } | undefined
  return row ? { id: row.id, username: row.username, createdAt: row.created_at } : undefined
}

/** Verifies a username/password pair. Returns the User on success, undefined otherwise. */
export function verifyPassword(rawDb: InstanceType<typeof Database>, username: string, password: string): User | undefined {
  const row = rawDb
    .prepare('SELECT id, username, password_hash, password_salt, created_at FROM users WHERE username = ?')
    .get(username) as
    | { id: number; username: string; password_hash: string; password_salt: string; created_at: number }
    | undefined
  if (!row) return undefined

  const candidate = hashPassword(password, row.password_salt)
  const expectedBuf = Buffer.from(row.password_hash, 'hex')
  const actualBuf = Buffer.from(candidate, 'hex')
  const matches = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)
  return matches ? { id: row.id, username: row.username, createdAt: row.created_at } : undefined
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Mints a new session token for the given user. Returns the raw (plaintext) token — only the hash is persisted. */
export function createSession(rawDb: InstanceType<typeof Database>, userId: number): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + sessionTtlSeconds()
  rawDb
    .prepare(
      'INSERT INTO sessions (session_token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(tokenHash, userId, now, expiresAt, now)
  return { token, expiresAt }
}

/**
 * Resolves a raw session token to its session info, refreshing `last_seen_at`
 * and extending `expires_at` on use (idle-window expiry per the design).
 * Returns undefined if the token is unknown or expired.
 */
export function resolveSessionToken(rawDb: InstanceType<typeof Database>, token: string): SessionInfo | undefined {
  const tokenHash = hashToken(token)
  const row = rawDb
    .prepare('SELECT user_id, expires_at FROM sessions WHERE session_token_hash = ?')
    .get(tokenHash) as { user_id: number; expires_at: number } | undefined
  if (!row) return undefined

  const now = Math.floor(Date.now() / 1000)
  if (row.expires_at <= now) {
    rawDb.prepare('DELETE FROM sessions WHERE session_token_hash = ?').run(tokenHash)
    return undefined
  }

  const newExpiresAt = now + sessionTtlSeconds()
  rawDb
    .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE session_token_hash = ?')
    .run(now, newExpiresAt, tokenHash)
  return { userId: row.user_id, expiresAt: newExpiresAt }
}

/** Revokes (deletes) a session by its raw token. No-op if the token is unknown. */
export function revokeSession(rawDb: InstanceType<typeof Database>, token: string): void {
  rawDb.prepare('DELETE FROM sessions WHERE session_token_hash = ?').run(hashToken(token))
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export interface CreateApiKeyOptions {
  label?: string
  /** Hard expiry in seconds from now, e.g. for CI keys that should not live forever. */
  expiresInSeconds?: number
}

/** Mints a new API key for the given user. Returns the raw (plaintext) key — only the hash is persisted. */
export function createApiKey(
  rawDb: InstanceType<typeof Database>,
  userId: number,
  opts: CreateApiKeyOptions = {},
): { token: string; prefix: string; expiresAt: number | null } {
  const token = randomBytes(32).toString('hex')
  const prefix = token.slice(0, 8)
  const keyHash = hashToken(token)
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = opts.expiresInSeconds ? now + opts.expiresInSeconds : null
  rawDb
    .prepare(
      'INSERT INTO api_keys (key_hash, key_prefix, user_id, label, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
    )
    .run(keyHash, prefix, userId, opts.label ?? null, now, expiresAt)
  return { token, prefix, expiresAt }
}

/**
 * Resolves a raw API key to its user ID. Returns undefined if the key is
 * unknown, revoked, or past its (optional) hard expiry.
 */
export function resolveApiKey(rawDb: InstanceType<typeof Database>, token: string): number | undefined {
  const keyHash = hashToken(token)
  const row = rawDb
    .prepare('SELECT user_id, expires_at, revoked_at FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { user_id: number; expires_at: number | null; revoked_at: number | null } | undefined
  if (!row) return undefined
  if (row.revoked_at !== null) return undefined
  const now = Math.floor(Date.now() / 1000)
  if (row.expires_at !== null && row.expires_at <= now) return undefined
  return row.user_id
}

export function listApiKeys(rawDb: InstanceType<typeof Database>, userId: number): ApiKeyInfo[] {
  const rows = rawDb
    .prepare(
      'SELECT key_prefix, user_id, label, created_at, expires_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at ASC',
    )
    .all(userId) as Array<{
    key_prefix: string
    user_id: number
    label: string | null
    created_at: number
    expires_at: number | null
    revoked_at: number | null
  }>
  return rows.map((r) => ({
    keyPrefix: r.key_prefix,
    userId: r.user_id,
    label: r.label,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
  }))
}

/**
 * Revokes an API key by its prefix, scoped to the owning user (a user can
 * only revoke their own keys). Returns the number of matching unrevoked keys
 * found before revocation (0 = not found, 1 = revoked, >1 = ambiguous — caller
 * should ask for a longer prefix; this function still revokes all matches).
 */
export function revokeApiKeyByPrefix(rawDb: InstanceType<typeof Database>, userId: number, prefix: string): number {
  const rows = rawDb
    .prepare('SELECT key_hash FROM api_keys WHERE user_id = ? AND key_prefix = ? AND revoked_at IS NULL')
    .all(userId, prefix) as Array<{ key_hash: string }>
  if (rows.length === 0) return 0
  const now = Math.floor(Date.now() / 1000)
  const stmt = rawDb.prepare('UPDATE api_keys SET revoked_at = ? WHERE key_hash = ?')
  for (const r of rows) stmt.run(now, r.key_hash)
  return rows.length
}
