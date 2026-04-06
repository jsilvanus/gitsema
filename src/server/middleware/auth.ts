import { timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

/**
 * Optional Bearer-token auth middleware.
 * When GITSEMA_SERVE_KEY is set, every request must carry
 * `Authorization: Bearer <key>` or the request is rejected with 401.
 * When the env var is unset the middleware is a no-op.
 *
 * Token comparison uses `crypto.timingSafeEqual` to prevent timing-oracle attacks.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.GITSEMA_SERVE_KEY
  if (!key) {
    next()
    return
  }
  const auth = req.headers.authorization
  const expected = Buffer.from(`Bearer ${key}`)
  const actual = Buffer.from(auth ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}
