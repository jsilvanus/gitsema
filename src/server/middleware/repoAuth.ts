/**
 * Read-route repo authorization gate (Phase 151 / review11 §2.2).
 *
 * The Multi-Tenant Auth Track (Phases 122–125) built `repo_grants` +
 * `resolveUserRepoAccess`/`roleSatisfies`, but they were wired only into the
 * index/register (`remote.ts`) and grant-management (`orgs.ts`) routes — none
 * of the ~16 read/search/analysis/evolution/graph/insights routes enforced
 * them. `repoSessionMiddleware` served any named `repoId` to any caller with
 * no grant check ("read any private repo by ID").
 *
 * This middleware runs **after** `repoSessionMiddleware` (so the active DB
 * session is the addressed repo's own DB — the authoritative source of that
 * repo's `visibility`, matching the Phase 126 read in `remote.ts`) and, when
 * the server is in **multi-tenant mode**, requires the caller to hold a `read`
 * grant on the addressed repo unless it is `public`.
 *
 * Enforcement is opt-in (`isMultiTenantMode()`), so a default open single-dev
 * server (no key, no flag) is unchanged. Two credentials bypass the grant
 * check because they already imply access: the global `GITSEMA_SERVE_KEY`
 * (operator/admin) and a legacy per-repo scoped `repo_tokens` token (already
 * scoped to its one repo).
 *
 * Repo-level only: per-branch grant filtering (rewriting the routes'
 * `branch: string` param into a per-user granted-branch set) is deferred to a
 * follow-on phase — see PLAN.md Phase 151 "Deferred".
 */

import type { Request, Response, NextFunction } from 'express'
import { getActiveSession, getRawDb } from '../../core/db/sqlite.js'
import { getRepo } from '../../core/indexing/repoRegistry.js'
import { resolveUserRepoAccess, roleSatisfies } from '../../core/auth/grants.js'
import { resolveRequestedRepoId } from './repoSession.js'
import { logger } from '../../utils/logger.js'

/**
 * True when the server should enforce per-user repo authorization on read
 * routes. Opt-in:
 *  - `GITSEMA_MULTI_TENANT` set explicitly wins (`1`/`true`/`yes`/`on` →
 *    enabled; anything else → disabled), giving operators an escape hatch.
 *  - Otherwise falls back to `GITSEMA_SERVE_KEY` presence: a keyed server is
 *    a shared deployment, so the gate engages.
 *  - A default open server (no key, no flag) stays unchanged.
 */
export function isMultiTenantMode(): boolean {
  const flag = process.env.GITSEMA_MULTI_TENANT
  if (flag !== undefined && flag !== '') {
    const v = flag.toLowerCase()
    return v === '1' || v === 'true' || v === 'yes' || v === 'on'
  }
  return Boolean(process.env.GITSEMA_SERVE_KEY)
}

export function repoAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Single-dev / open deployment: no enforcement, behavior unchanged.
  if (!isMultiTenantMode()) {
    next()
    return
  }

  const { repoId } = resolveRequestedRepoId(req)
  // No repo addressed → default cwd session, single-repo semantics — nothing
  // to gate.
  if (!repoId) {
    next()
    return
  }

  // Operator/admin (global key) has full access.
  if (req.globalKeyAuth) {
    next()
    return
  }

  // A legacy per-repo scoped token already implies access to its one repo
  // (and `repoSessionMiddleware` has already 403'd any mismatch).
  if (req.repoTokenScoped) {
    next()
    return
  }

  // Public repos are readable by anyone. Visibility is read from the repo's
  // own (now-active) DB mirror row — the authoritative source used by the
  // Phase 126 register path (`remote.ts`). A missing mirror row defaults to
  // private (safe default → grant required).
  let isPublic = false
  try {
    const repo = getRepo(getActiveSession(), repoId)
    isPublic = repo?.visibility === 'public'
  } catch (err) {
    logger.debug(`repoAuthMiddleware: visibility lookup failed for ${repoId}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (isPublic) {
    next()
    return
  }

  // Private repo: require a `read` grant for the resolved user. Grants live in
  // the control-plane DB (`getRawDb()`), unaffected by the active-session
  // switch above.
  if (req.userId !== undefined) {
    try {
      const role = resolveUserRepoAccess(getRawDb(), req.userId, repoId)
      if (roleSatisfies(role, 'read')) {
        next()
        return
      }
    } catch (err) {
      logger.debug(`repoAuthMiddleware: grant lookup failed for user ${req.userId} on ${repoId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  res.status(403).json({ error: 'Forbidden: no read access to this repo' })
}
