import type { Request, Response, NextFunction } from 'express'

/**
 * Optional Bearer-token auth middleware.
 * When GITSEMA_SERVE_KEY is set, every request must carry
 * `Authorization: Bearer <key>` or the request is rejected with 401.
 * When the env var is unset the middleware is a no-op.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.GITSEMA_SERVE_KEY
  if (!key) {
    next()
    return
  }
  const auth = req.headers.authorization
  if (!auth || auth !== `Bearer ${key}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}
