/**
 * Identity/authorization audit trail — Phase 125 / multi-tenant-auth §5 Phase D.
 *
 * Records sensitive actions (grant create/revoke, token create/revoke, login
 * success/failure, org membership changes, repo org moves) so they can later
 * be queried by org or repo. Lowest-priority phase of the track — nothing in
 * Phases A–C depends on it.
 *
 * Scope deviation: only the HTTP routes (`src/server/routes/auth.ts`,
 * `src/server/routes/orgs.ts`) call `recordAuditEvent`. The equivalent
 * operator-only CLI-direct paths (`gitsema repos grant`, `gitsema orgs
 * members add`, `gitsema auth create-user`, etc.) do **not** get logged in
 * v1 — those already require local DB access, a stronger trust boundary than
 * the network surface this audit trail is primarily meant to cover.
 */

import type Database from 'better-sqlite3'
import { logger } from '../../utils/logger.js'

export type AuditAction =
  | 'grant.create'
  | 'grant.revoke'
  | 'token.create'
  | 'token.revoke'
  | 'login.success'
  | 'login.failure'
  | 'org.member.add'
  | 'org.member.remove'
  | 'org.repo.moved'

export interface AuditLogEntry {
  id: number
  actorUserId: number | null
  action: AuditAction
  target: string | null
  orgId: number | null
  repoId: string | null
  createdAt: number
}

export interface RecordAuditEventOptions {
  actorUserId?: number | null
  action: AuditAction
  target?: string | null
  orgId?: number | null
  repoId?: string | null
}

function rowToEntry(row: {
  id: number
  actor_user_id: number | null
  action: string
  target: string | null
  org_id: number | null
  repo_id: string | null
  created_at: number
}): AuditLogEntry {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    action: row.action as AuditAction,
    target: row.target,
    orgId: row.org_id,
    repoId: row.repo_id,
    createdAt: row.created_at,
  }
}

/** Records an audit event. Never throws — callers should not have their primary action fail because logging failed. */
export function recordAuditEvent(rawDb: InstanceType<typeof Database>, opts: RecordAuditEventOptions): void {
  const createdAt = Math.floor(Date.now() / 1000)
  try {
    rawDb
      .prepare(
        `INSERT INTO audit_log (actor_user_id, action, target, org_id, repo_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(opts.actorUserId ?? null, opts.action, opts.target ?? null, opts.orgId ?? null, opts.repoId ?? null, createdAt)
  } catch (err) {
    logger.warn(`recordAuditEvent failed for action '${opts.action}': ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface ListAuditLogOptions {
  orgId?: number
  repoId?: string
  limit?: number
}

/** Lists audit log entries, optionally filtered by org or repo, newest first. */
export function listAuditLog(rawDb: InstanceType<typeof Database>, opts: ListAuditLogOptions = {}): AuditLogEntry[] {
  const conditions: string[] = []
  const params: Array<number | string> = []
  if (opts.orgId !== undefined) {
    conditions.push('org_id = ?')
    params.push(opts.orgId)
  }
  if (opts.repoId !== undefined) {
    conditions.push('repo_id = ?')
    params.push(opts.repoId)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = opts.limit ?? 100
  const rows = rawDb
    .prepare(
      `SELECT id, actor_user_id, action, target, org_id, repo_id, created_at FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, limit) as Array<Parameters<typeof rowToEntry>[0]>
  return rows.map(rowToEntry)
}
