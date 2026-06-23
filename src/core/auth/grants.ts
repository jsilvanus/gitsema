/**
 * Repo/branch grants — Axis C (Grant) of the three-axis authorization model
 * (Phase 123 / multi-tenant-auth §5 Phase B).
 *
 * A grant is `(user_id, repo_id, role, branch_pattern)`. `role` is one of
 * 'read' | 'write' | 'owner' ('owner' implies write, plus the ability to
 * manage grants on that repo without being an org_admin). `branch_pattern`
 * is nullable: null grants apply to all branches, otherwise it's matched
 * against the requested branch with minimatch (glob), same library already
 * used for `--include-glob` in the indexer.
 */

import type Database from 'better-sqlite3'
import { minimatch } from 'minimatch'

export type GrantRole = 'read' | 'write' | 'owner'

export interface Grant {
  id: number
  userId: number
  repoId: string
  role: GrantRole
  branchPattern: string | null
  grantedBy: number
  createdAt: number
  /** Provenance, e.g. 'auto-public' for attach-as-reader grants (Phase 126). NULL for manually-issued grants. */
  source: string | null
}

const ROLE_RANK: Record<GrantRole, number> = { read: 1, write: 2, owner: 3 }

const GRANT_COLUMNS = 'id, user_id, repo_id, role, branch_pattern, granted_by, created_at, source'

function rowToGrant(row: {
  id: number
  user_id: number
  repo_id: string
  role: string
  branch_pattern: string | null
  granted_by: number
  created_at: number
  source: string | null
}): Grant {
  return {
    id: row.id,
    userId: row.user_id,
    repoId: row.repo_id,
    role: row.role as GrantRole,
    branchPattern: row.branch_pattern,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
    source: row.source ?? null,
  }
}

/**
 * Creates or replaces a grant for `(userId, repoId, branchPattern)`.
 * Re-granting the same user/repo/branch-pattern triple updates the role.
 */
export function createGrant(
  rawDb: InstanceType<typeof Database>,
  opts: { userId: number; repoId: string; role: GrantRole; branchPattern?: string | null; grantedBy: number; source?: string | null },
): Grant {
  const createdAt = Math.floor(Date.now() / 1000)
  const branchPattern = opts.branchPattern ?? null
  const source = opts.source ?? null
  // SQLite's UNIQUE index treats every NULL branch_pattern as distinct, so
  // ON CONFLICT can't be used to dedupe all-branches grants — match manually.
  const existing = rawDb
    .prepare('SELECT id FROM repo_grants WHERE user_id = ? AND repo_id = ? AND branch_pattern IS ?')
    .get(opts.userId, opts.repoId, branchPattern) as { id: number } | undefined
  if (existing) {
    rawDb.prepare('UPDATE repo_grants SET role = ?, granted_by = ? WHERE id = ?').run(opts.role, opts.grantedBy, existing.id)
  } else {
    rawDb
      .prepare(
        `INSERT INTO repo_grants (user_id, repo_id, role, branch_pattern, granted_by, created_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(opts.userId, opts.repoId, opts.role, branchPattern, opts.grantedBy, createdAt, source)
  }
  const row = rawDb
    .prepare(
      `SELECT ${GRANT_COLUMNS} FROM repo_grants WHERE user_id = ? AND repo_id = ? AND branch_pattern IS ?`,
    )
    .get(opts.userId, opts.repoId, branchPattern) as Parameters<typeof rowToGrant>[0]
  return rowToGrant(row)
}

/** Revokes all grants for a user on a repo (every branch_pattern row). */
export function revokeGrant(rawDb: InstanceType<typeof Database>, userId: number, repoId: string): number {
  const result = rawDb.prepare('DELETE FROM repo_grants WHERE user_id = ? AND repo_id = ?').run(userId, repoId)
  return result.changes
}

/** Lists every grant on a repo, across all users. */
export function listGrants(rawDb: InstanceType<typeof Database>, repoId: string): Grant[] {
  const rows = rawDb
    .prepare(
      `SELECT ${GRANT_COLUMNS} FROM repo_grants WHERE repo_id = ? ORDER BY created_at ASC`,
    )
    .all(repoId) as Array<Parameters<typeof rowToGrant>[0]>
  return rows.map(rowToGrant)
}

/** Lists every grant held by a user, across all repos. */
export function listGrantsForUser(rawDb: InstanceType<typeof Database>, userId: number): Grant[] {
  const rows = rawDb
    .prepare(
      `SELECT ${GRANT_COLUMNS} FROM repo_grants WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .all(userId) as Array<Parameters<typeof rowToGrant>[0]>
  return rows.map(rowToGrant)
}

/**
 * Resolves the highest role a user holds on a repo, optionally scoped to a
 * branch. When `branch` is omitted, only branch_pattern-less (all-branches)
 * grants are considered — a caller that needs the union across all of a
 * user's branch-scoped grants should pass the specific branch it cares about
 * instead. Returns undefined if the user has no applicable grant.
 */
export function resolveUserRepoAccess(
  rawDb: InstanceType<typeof Database>,
  userId: number,
  repoId: string,
  branch?: string,
): GrantRole | undefined {
  const grants = rawDb
    .prepare(`SELECT ${GRANT_COLUMNS} FROM repo_grants WHERE user_id = ? AND repo_id = ?`)
    .all(userId, repoId) as Array<Parameters<typeof rowToGrant>[0]>

  let best: GrantRole | undefined
  for (const row of grants) {
    const grant = rowToGrant(row)
    const applies =
      grant.branchPattern === null ||
      (branch !== undefined && minimatch(branch, grant.branchPattern, { dot: true }))
    if (!applies) continue
    if (best === undefined || ROLE_RANK[grant.role] > ROLE_RANK[best]) best = grant.role
  }
  return best
}

/** True if `role` satisfies a `required` role threshold (owner > write > read). */
export function roleSatisfies(role: GrantRole | undefined, required: GrantRole): boolean {
  if (role === undefined) return false
  return ROLE_RANK[role] >= ROLE_RANK[required]
}

/**
 * Moves a repo to a different org. Grants are keyed by (user_id, repo_id) —
 * not org — so they survive the move untouched.
 */
export function moveRepoToOrg(rawDb: InstanceType<typeof Database>, repoId: string, orgId: number | null): void {
  rawDb.prepare('UPDATE repos SET org_id = ? WHERE id = ?').run(orgId, repoId)
}

export function getRepoOrgId(rawDb: InstanceType<typeof Database>, repoId: string): number | null {
  const row = rawDb.prepare('SELECT org_id FROM repos WHERE id = ?').get(repoId) as { org_id: number | null } | undefined
  return row?.org_id ?? null
}
