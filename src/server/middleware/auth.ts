import { timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { getRawDb } from '../../core/db/sqlite.js'

// Extend Express Request with optional repoId scope injected by scoped token auth
declare global {
  namespace Express {
    interface Request {
      repoId?: string
    }
  }
}

/**
 * Optional Bearer-token auth middleware.
 * When GITSEMA_SERVE_KEY is set, every request must carry
 * `Authorization: Bearer <key>` or the request is rejected with 401.
 * When the env var is unset the middleware is a no-op.
 *
 * Per-repo scoped tokens: if the supplied token is not the global
 * GITSEMA_SERVE_KEY, the middleware looks it up in the `repo_tokens` table.
 * When a match is found, `req.repoId` is set to the scoped repo ID and the
 * request proceeds. This allows multi-repo deployments to give each consumer
 * a token that only grants access to a specific repo.
 *
 * Token comparison uses `crypto.timingSafeEqual` to prevent timing-oracle attacks.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const globalKey = process.env.GITSEMA_SERVE_KEY
  if (!globalKey) {
    next()
    return
  }
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  // Check global key first (constant-time comparison)
  const expectedBuf = Buffer.from(globalKey)
  const actualBuf = Buffer.from(token)
  const isGlobal =
    expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)

  if (isGlobal) {
    next()
    return
  }

  // Check per-repo scoped token in repo_tokens table
  if (token) {
    try {
      const rawDb = getRawDb()
      const row = rawDb
        .prepare('SELECT repo_id FROM repo_tokens WHERE token = ?')
        .get(token) as { repo_id: string } | undefined
      if (row) {
        req.repoId = row.repo_id
        next()
        return
      }
    } catch {
      // DB not open yet or table missing — fall through to 401
    }
  }

  res.status(401).json({ error: 'Unauthorized' })
}
