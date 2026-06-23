/**
 * SSO/OIDC identity linking — Phase 124 / multi-tenant-auth §5 Phase C.
 *
 * Scope deviation from the full design-doc spec (see docs/PLAN.md's Phase 124
 * entry): this module ships the linking data model (`sso_identities`), the
 * provider allowlist gate, and self-service/operator CRUD for linked
 * identities. It does **not** implement the device-code browser-based OIDC
 * flow (`gitsema auth login <server-url> --sso <provider>`) described in the
 * design doc, since that requires choosing and integrating an actual OIDC
 * client library — a new dependency the design doc itself flags as needing a
 * deliberate decision against CLAUDE.md's minimal-deps preference, and one
 * that can't be meaningfully tested here without a live identity provider.
 * Linking an external identity to a user today is an operator action
 * (`gitsema auth sso link`), the same precedent as `gitsema auth create-user`
 * in Phase 122 — a user resolves via a linked identity exactly as the design
 * intends, just provisioned out-of-band instead of via a live OIDC exchange.
 */

import type Database from 'better-sqlite3'
import { getConfigValue } from '../config/configManager.js'

export interface SsoIdentity {
  id: number
  provider: string
  externalId: string
  userId: number
  linkedAt: number
}

export class SsoIdentityTakenError extends Error {
  constructor(provider: string, externalId: string) {
    super(`SSO identity '${provider}:${externalId}' is already linked to a user`)
  }
}

function rowToIdentity(row: { id: number; provider: string; external_id: string; user_id: number; linked_at: number }): SsoIdentity {
  return { id: row.id, provider: row.provider, externalId: row.external_id, userId: row.user_id, linkedAt: row.linked_at }
}

/**
 * The set of providers allowed to be linked, from `auth.ssoProviders` /
 * `GITSEMA_SSO_PROVIDERS` (comma-separated provider names). Empty by default
 * — no provider is allowed until explicitly configured.
 */
export function getAllowedSsoProviders(cwd?: string): string[] {
  const { value } = getConfigValue('auth.ssoProviders', cwd)
  const raw = typeof value === 'string' ? value : undefined
  if (!raw) return []
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

export function isSsoProviderAllowed(provider: string): boolean {
  return getAllowedSsoProviders().includes(provider)
}

export class SsoProviderNotAllowedError extends Error {
  constructor(provider: string) {
    super(`SSO provider '${provider}' is not in the allowlist (set GITSEMA_SSO_PROVIDERS to allow it)`)
  }
}

/**
 * Links an external (provider, externalId) identity to a user. Throws
 * SsoProviderNotAllowedError if the provider isn't allowlisted, or
 * SsoIdentityTakenError if that external identity is already linked to a
 * (possibly different) user.
 */
export function linkSsoIdentity(
  rawDb: InstanceType<typeof Database>,
  opts: { provider: string; externalId: string; userId: number },
): SsoIdentity {
  if (!isSsoProviderAllowed(opts.provider)) throw new SsoProviderNotAllowedError(opts.provider)

  const existing = rawDb
    .prepare('SELECT id FROM sso_identities WHERE provider = ? AND external_id = ?')
    .get(opts.provider, opts.externalId) as { id: number } | undefined
  if (existing) throw new SsoIdentityTakenError(opts.provider, opts.externalId)

  const linkedAt = Math.floor(Date.now() / 1000)
  const result = rawDb
    .prepare('INSERT INTO sso_identities (provider, external_id, user_id, linked_at) VALUES (?, ?, ?, ?)')
    .run(opts.provider, opts.externalId, opts.userId, linkedAt)
  return { id: Number(result.lastInsertRowid), provider: opts.provider, externalId: opts.externalId, userId: opts.userId, linkedAt }
}

/** Unlinks an identity. Returns the number of rows removed (0 or 1). */
export function unlinkSsoIdentity(rawDb: InstanceType<typeof Database>, provider: string, externalId: string): number {
  const result = rawDb.prepare('DELETE FROM sso_identities WHERE provider = ? AND external_id = ?').run(provider, externalId)
  return result.changes
}

/** Resolves a linked identity to its user ID, or undefined if unlinked. */
export function resolveSsoIdentity(rawDb: InstanceType<typeof Database>, provider: string, externalId: string): number | undefined {
  const row = rawDb
    .prepare('SELECT user_id FROM sso_identities WHERE provider = ? AND external_id = ?')
    .get(provider, externalId) as { user_id: number } | undefined
  return row?.user_id
}

/** Lists every identity linked to a user. */
export function listSsoIdentitiesForUser(rawDb: InstanceType<typeof Database>, userId: number): SsoIdentity[] {
  const rows = rawDb
    .prepare('SELECT id, provider, external_id, user_id, linked_at FROM sso_identities WHERE user_id = ? ORDER BY linked_at ASC')
    .all(userId) as Array<Parameters<typeof rowToIdentity>[0]>
  return rows.map(rowToIdentity)
}
