import { timingSafeEqual, createHash } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { getRawDb } from '../../core/db/sqlite.js'
import { resolveSessionToken, resolveApiKey } from '../../core/auth/identity.js'

// Extend Express Request with optional repoId scope injected by scoped token auth,
// and optional userId injected by user-credential auth (Phase 122).
declare global {
  namespace Express {
    interface Request {
      repoId?: string
      userId?: number
    }
  }
}

/**
 * Hash a raw token to its SHA-256 hex string for constant-time DB lookup.
 * Tokens are stored as SHA-256 hashes at rest (review7 §4.1).
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Optional Bearer-token auth middleware.
 *
 * Resolution order (Phase 122 — multi-tenant-auth §5 Phase A):
 *   1. User credential: a session token or API key minted via `gitsema auth`
 *      (`POST /api/v1/auth/login` / `/auth/tokens`). On match, sets
 *      `req.userId` and proceeds — this path is checked regardless of
 *      whether GITSEMA_SERVE_KEY is set, since user accounts are independent
 *      of the legacy global-key deployment model.
 *   2. Legacy global key: when GITSEMA_SERVE_KEY is set, every request must
 *      carry `Authorization: Bearer <key>` or the request is rejected with
 *      401. When the env var is unset and no user credential matched, the
 *      middleware is a no-op (today's default-open local-dev behavior).
 *   3. Legacy per-repo scoped token: if the supplied token is not the global
 *      key, the middleware computes its SHA-256 hash and looks it up in the
 *      `repo_tokens` table (review7 §4.1 — tokens are stored hashed). When a
 *      match is found, `req.repoId` is set to the scoped repo ID.
 *
 * No authorization decisions are made here yet — a resolved `req.userId`
 * with no grants can do nothing beyond `whoami` until Phase 123 ships.
 *
 * Token comparison uses `crypto.timingSafeEqual` to prevent timing-oracle attacks.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  if (token) {
    try {
      const rawDb = getRawDb()
      const session = resolveSessionToken(rawDb, token)
      if (session) {
        req.userId = session.userId
        next()
        return
      }
      const apiKeyUserId = resolveApiKey(rawDb, token)
      if (apiKeyUserId !== undefined) {
        req.userId = apiKeyUserId
        next()
        return
      }
    } catch {
      // DB not open yet or tables missing — fall through to legacy auth
    }
  }

  const globalKey = process.env.GITSEMA_SERVE_KEY
  if (!globalKey) {
    next()
    return
  }

  // Check global key (constant-time comparison)
  const expectedBuf = Buffer.from(globalKey)
  const actualBuf = Buffer.from(token)
  const isGlobal =
    expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)

  if (isGlobal) {
    next()
    return
  }

  // Check per-repo scoped token: compare SHA-256 hash of the incoming token
  // against the stored hash in repo_tokens (review7 §4.1).
  if (token) {
    try {
      const rawDb = getRawDb()
      const tokenHash = hashToken(token)
      const row = rawDb
        .prepare('SELECT repo_id FROM repo_tokens WHERE token_hash = ?')
        .get(tokenHash) as { repo_id: string } | undefined
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
