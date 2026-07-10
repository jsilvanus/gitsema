import type { Request, Response, NextFunction } from 'express'
import { getOrOpenSessionAtPath, withDbSession } from '../../core/db/sqlite.js'
import { getRegistrySession, getRepo } from '../../core/indexing/repoRegistry.js'

/**
 * Resolves which repo's index DB a search/query request should run against.
 *
 * - `repoId` may be supplied in the request body (POST) or query string (GET).
 * - If a per-repo scoped token set `req.repoId` (see `authMiddleware`), it must
 *   match any explicitly supplied `repoId` (403 on mismatch), and is used as a
 *   fallback when no `repoId` is supplied.
 * - If a `repoId` is resolved, it must exist in the persisted repo registry and
 *   have a `dbPath` (404 otherwise). The resolved DB session is then made the
 *   active session for the rest of the request via `withDbSession`.
 * - If no `repoId` is resolved (single-dev mode), the request proceeds against
 *   the default cwd-relative `.gitsema/index.db` session, unchanged.
 */
/**
 * Resolves the repoId a request is asking for, using the same precedence as
 * `repoSessionMiddleware`: an explicit `repoId` in the request body (POST) or
 * query string (GET), else the per-repo scope of a legacy scoped token
 * (`req.repoId`, set by `authMiddleware`). Returns `repoId: undefined` in
 * single-dev mode (no repoId named, no scoped token). Shared with
 * `repoAuthMiddleware` (Phase 151) so both middlewares agree on which repo is
 * being addressed.
 */
export function resolveRequestedRepoId(req: Request): { requestedRepoId?: string; repoId?: string } {
  const bodyRepoId = req.body && typeof req.body === 'object' && typeof (req.body as Record<string, unknown>)['repoId'] === 'string'
    ? (req.body as Record<string, unknown>)['repoId'] as string
    : undefined
  const queryRepoId = typeof req.query['repoId'] === 'string' ? req.query['repoId'] as string : undefined
  const requestedRepoId = bodyRepoId ?? queryRepoId
  return { requestedRepoId, repoId: requestedRepoId ?? req.repoId }
}

export function repoSessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { requestedRepoId, repoId } = resolveRequestedRepoId(req)

  if (req.repoId && requestedRepoId && requestedRepoId !== req.repoId) {
    res.status(403).json({ error: 'Token is not authorized for this repo' })
    return
  }

  if (!repoId) {
    next()
    return
  }

  const repo = getRepo(getRegistrySession(), repoId)
  if (!repo || !repo.dbPath) {
    res.status(404).json({ error: `repoId '${repoId}' not found` })
    return
  }

  const session = getOrOpenSessionAtPath(repo.dbPath)
  void withDbSession(session, () => new Promise<void>((resolve) => {
    res.on('finish', resolve)
    res.on('close', resolve)
    next()
  }))
}
