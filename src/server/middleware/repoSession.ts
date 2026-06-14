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
export function repoSessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const bodyRepoId = req.body && typeof req.body === 'object' && typeof (req.body as Record<string, unknown>)['repoId'] === 'string'
    ? (req.body as Record<string, unknown>)['repoId'] as string
    : undefined
  const queryRepoId = typeof req.query['repoId'] === 'string' ? req.query['repoId'] as string : undefined
  const requestedRepoId = bodyRepoId ?? queryRepoId

  if (req.repoId && requestedRepoId && requestedRepoId !== req.repoId) {
    res.status(403).json({ error: 'Token is not authorized for this repo' })
    return
  }

  const repoId = requestedRepoId ?? req.repoId
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
