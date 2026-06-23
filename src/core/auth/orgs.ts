/**
 * Orgs & personal groups — Axis B (Membership) of the three-axis authorization
 * model (Phase 123 / multi-tenant-auth §5 Phase B).
 *
 * `orgs.kind` is either:
 *   - 'personal': auto-created alongside a user, exactly one member (the
 *     owning user, as 'org_admin') forever. The route layer rejects any
 *     attempt to add/remove members on a personal org before checking roles.
 *   - 'team': explicitly created via `gitsema orgs create`, any number of
 *     members with 'org_admin' or 'member' roles.
 */

import type Database from 'better-sqlite3'
import { getConfigValue } from '../config/configManager.js'

export type OrgKind = 'personal' | 'team'
export type OrgRole = 'org_admin' | 'member'

export interface Org {
  id: number
  name: string
  kind: OrgKind
  createdAt: number
}

export interface OrgMembership {
  orgId: number
  userId: number
  role: OrgRole
  joinedAt: number
}

export class PersonalOrgImmutableError extends Error {
  constructor() {
    super('Personal orgs always have exactly one member and cannot be modified')
  }
}

/**
 * Whether new users/repos should get a personal org by default.
 * Default true; overridden by GITSEMA_PERSONAL_GROUPS or the
 * `auth.personalGroups` config key.
 */
export function isPersonalGroupsEnabled(cwd?: string): boolean {
  const { value } = getConfigValue('auth.personalGroups', cwd)
  if (value === undefined) return true
  if (typeof value === 'boolean') return value
  return String(value) !== 'false'
}

function rowToOrg(row: { id: number; name: string; kind: string; created_at: number }): Org {
  return { id: row.id, name: row.name, kind: row.kind as OrgKind, createdAt: row.created_at }
}

/** Creates a new org. `kind` defaults to 'team' — personal orgs should go through provisionPersonalOrg. */
export function createOrg(rawDb: InstanceType<typeof Database>, name: string, kind: OrgKind = 'team'): Org {
  const createdAt = Math.floor(Date.now() / 1000)
  const result = rawDb
    .prepare('INSERT INTO orgs (name, kind, created_at) VALUES (?, ?, ?)')
    .run(name, kind, createdAt)
  return { id: Number(result.lastInsertRowid), name, kind, createdAt }
}

export function getOrgById(rawDb: InstanceType<typeof Database>, orgId: number): Org | undefined {
  const row = rawDb
    .prepare('SELECT id, name, kind, created_at FROM orgs WHERE id = ?')
    .get(orgId) as { id: number; name: string; kind: string; created_at: number } | undefined
  return row ? rowToOrg(row) : undefined
}

export function getOrgByName(rawDb: InstanceType<typeof Database>, name: string): Org | undefined {
  const row = rawDb
    .prepare('SELECT id, name, kind, created_at FROM orgs WHERE name = ?')
    .get(name) as { id: number; name: string; kind: string; created_at: number } | undefined
  return row ? rowToOrg(row) : undefined
}

/**
 * Creates a 'personal' org for `userId` and adds them as its sole 'org_admin'
 * member. Called automatically on user creation when personal groups are
 * enabled (see identity.ts callers).
 */
export function provisionPersonalOrg(rawDb: InstanceType<typeof Database>, userId: number, username: string): Org {
  const org = createOrg(rawDb, username, 'personal')
  const joinedAt = Math.floor(Date.now() / 1000)
  rawDb
    .prepare('INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(org.id, userId, 'org_admin', joinedAt)
  return org
}

/**
 * Provisions a personal org for `userId` if personal groups are enabled and
 * the user doesn't already have one. Safe to call unconditionally after any
 * user-creation path (CLI `auth create-user`, `users create`, etc).
 */
export function maybeProvisionPersonalOrg(
  rawDb: InstanceType<typeof Database>,
  userId: number,
  username: string,
  cwd?: string,
): Org | undefined {
  if (!isPersonalGroupsEnabled(cwd)) return undefined
  const existing = getPersonalOrgForUser(rawDb, userId)
  if (existing) return existing
  return provisionPersonalOrg(rawDb, userId, username)
}

/** Returns the personal org owned by `userId`, if one exists. */
export function getPersonalOrgForUser(rawDb: InstanceType<typeof Database>, userId: number): Org | undefined {
  const row = rawDb
    .prepare(
      `SELECT o.id, o.name, o.kind, o.created_at FROM orgs o
       JOIN org_members m ON m.org_id = o.id
       WHERE o.kind = 'personal' AND m.user_id = ?`,
    )
    .get(userId) as { id: number; name: string; kind: string; created_at: number } | undefined
  return row ? rowToOrg(row) : undefined
}

/**
 * Adds a member to an org. Throws PersonalOrgImmutableError if the target
 * org is 'personal' — those always have exactly one member.
 */
export function addOrgMember(
  rawDb: InstanceType<typeof Database>,
  orgId: number,
  userId: number,
  role: OrgRole = 'member',
): OrgMembership {
  const org = getOrgById(rawDb, orgId)
  if (org?.kind === 'personal') throw new PersonalOrgImmutableError()

  const joinedAt = Math.floor(Date.now() / 1000)
  rawDb
    .prepare('INSERT OR REPLACE INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(orgId, userId, role, joinedAt)
  return { orgId, userId, role, joinedAt }
}

/** Removes a member from an org. Throws PersonalOrgImmutableError if the target org is 'personal'. */
export function removeOrgMember(rawDb: InstanceType<typeof Database>, orgId: number, userId: number): void {
  const org = getOrgById(rawDb, orgId)
  if (org?.kind === 'personal') throw new PersonalOrgImmutableError()

  rawDb.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(orgId, userId)
}

export function getOrgMembership(
  rawDb: InstanceType<typeof Database>,
  orgId: number,
  userId: number,
): OrgMembership | undefined {
  const row = rawDb
    .prepare('SELECT org_id, user_id, role, joined_at FROM org_members WHERE org_id = ? AND user_id = ?')
    .get(orgId, userId) as { org_id: number; user_id: number; role: string; joined_at: number } | undefined
  return row ? { orgId: row.org_id, userId: row.user_id, role: row.role as OrgRole, joinedAt: row.joined_at } : undefined
}

export function isOrgAdmin(rawDb: InstanceType<typeof Database>, orgId: number, userId: number): boolean {
  return getOrgMembership(rawDb, orgId, userId)?.role === 'org_admin'
}

/** Lists every org a user belongs to. */
export function listOrgsForUser(rawDb: InstanceType<typeof Database>, userId: number): Array<Org & { role: OrgRole }> {
  const rows = rawDb
    .prepare(
      `SELECT o.id, o.name, o.kind, o.created_at, m.role FROM orgs o
       JOIN org_members m ON m.org_id = o.id
       WHERE m.user_id = ?
       ORDER BY o.created_at ASC`,
    )
    .all(userId) as Array<{ id: number; name: string; kind: string; created_at: number; role: string }>
  return rows.map((r) => ({ ...rowToOrg(r), role: r.role as OrgRole }))
}

/** Lists every member of an org. */
export function listOrgMembers(rawDb: InstanceType<typeof Database>, orgId: number): OrgMembership[] {
  const rows = rawDb
    .prepare('SELECT org_id, user_id, role, joined_at FROM org_members WHERE org_id = ? ORDER BY joined_at ASC')
    .all(orgId) as Array<{ org_id: number; user_id: number; role: string; joined_at: number }>
  return rows.map((r) => ({ orgId: r.org_id, userId: r.user_id, role: r.role as OrgRole, joinedAt: r.joined_at }))
}
