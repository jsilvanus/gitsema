/**
 * Rate-limiting middleware (P2 operational readiness).
 *
 * Uses `express-rate-limit` to protect the gitsema HTTP server.
 *
 * Behaviour
 * ---------
 * - When GITSEMA_SERVE_KEY is set (bearer auth enabled):
 *     The key identifier extracted from the Authorization header is used as
 *     the rate-limit key so each token has its own window independently of IP.
 * - When GITSEMA_SERVE_KEY is unset (open server):
 *     Rate-limiting falls back to the client IP address.
 *
 * Configuration env vars
 * ----------------------
 * GITSEMA_RATE_LIMIT_RPM    Requests per minute (default: 300)
 * GITSEMA_RATE_LIMIT_BURST  Maximum burst size above the window (default: RPM)
 *                           Note: express-rate-limit uses a fixed window, so
 *                           "burst" maps to the per-window limit directly.
 *
 * Compliance
 * ----------
 * Returns 429 with:
 *   - Retry-After header (seconds until the window resets)
 *   - JSON body { error: "Too Many Requests", retryAfter: <seconds> }
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request, Response } from 'express'

function getRpm(): number {
  const raw = process.env.GITSEMA_RATE_LIMIT_RPM
  const parsed = raw ? parseInt(raw, 10) : NaN
  return isNaN(parsed) || parsed <= 0 ? 300 : parsed
}

function getLimit(): number {
  const raw = process.env.GITSEMA_RATE_LIMIT_BURST
  const parsed = raw ? parseInt(raw, 10) : NaN
  return isNaN(parsed) || parsed <= 0 ? getRpm() : parsed
}

/**
 * Builds and returns the rate-limiting middleware.
 * Called once during app creation so env vars are read at startup.
 */
export function buildRateLimiter() {
  const windowMs = 60 * 1000 // 1 minute
  const limit = getLimit()

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // RateLimit header (RFC draft 7)
    legacyHeaders: false,
    // Use bearer token as key when auth is enabled; fall back to IP
    keyGenerator(req: Request): string {
      if (process.env.GITSEMA_SERVE_KEY) {
        const auth = req.headers.authorization ?? ''
        // Extract the token part from "Bearer <token>"
        if (auth.startsWith('Bearer ')) return auth.slice(7)
        // No token provided — treat as anonymous (will fail auth anyway)
        return `anon:${ipKeyGenerator(req.ip ?? '')}`
      }
      return ipKeyGenerator(req.ip ?? '')
    },
    handler(_req: Request, res: Response): void {
      const retryAfter = Math.ceil(windowMs / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      res.status(429).json({
        error: 'Too Many Requests',
        retryAfter,
      })
    },
  })
}
