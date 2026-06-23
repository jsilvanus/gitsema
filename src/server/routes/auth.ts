/**
 * Identity & credentials routes (Phase 122 / multi-tenant-auth §5 Phase A).
 *
 * POST /api/v1/auth/login         — username/password -> session token
 * POST /api/v1/auth/logout        — revoke the session token used to call it
 * POST /api/v1/auth/tokens        — mint a new API key for the calling user
 * GET  /api/v1/auth/tokens        — list the calling user's API keys
 * DELETE /api/v1/auth/tokens/:prefix — revoke an API key by its prefix
 * GET  /api/v1/auth/whoami        — resolve the calling user's identity
 *
 * These routes are registered before the global authMiddleware in app.ts is
 * relevant: login itself needs to be reachable without a bearer token, while
 * the rest require a resolved req.userId (set by authMiddleware via session
 * or API-key resolution).
 */

import { Router } from 'express'
import { z } from 'zod'
import { getRawDb } from '../../core/db/sqlite.js'
import { authMiddleware } from '../middleware/auth.js'
import {
  verifyPassword,
  createSession,
  revokeSession,
  createApiKey,
  listApiKeys,
  revokeApiKeyByPrefix,
  getUserById,
} from '../../core/auth/identity.js'
import { listSsoIdentitiesForUser, unlinkSsoIdentity } from '../../core/auth/sso.js'
import { recordAuditEvent } from '../../core/auth/auditLog.js'

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const CreateTokenSchema = z.object({
  label: z.string().optional(),
  expiresInSeconds: z.number().int().positive().optional(),
})

function requireUserId(req: import('express').Request, res: import('express').Response): number | undefined {
  if (req.userId === undefined) {
    res.status(401).json({ error: 'Unauthorized' })
    return undefined
  }
  return req.userId
}

export function authRouter(): Router {
  const router = Router()

  router.post('/login', (req, res) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const rawDb = getRawDb()
    const user = verifyPassword(rawDb, parsed.data.username, parsed.data.password)
    if (!user) {
      recordAuditEvent(rawDb, { action: 'login.failure', target: parsed.data.username })
      res.status(401).json({ error: 'Invalid username or password' })
      return
    }
    const { token, expiresAt } = createSession(rawDb, user.id)
    recordAuditEvent(rawDb, { actorUserId: user.id, action: 'login.success', target: user.username })
    res.json({ token, expiresAt, username: user.username })
  })

  router.post('/logout', authMiddleware, (req, res) => {
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) {
      res.status(400).json({ error: 'Missing bearer token' })
      return
    }
    revokeSession(getRawDb(), token)
    res.json({ ok: true })
  })

  router.get('/whoami', authMiddleware, (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const user = getUserById(getRawDb(), userId)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json({ id: user.id, username: user.username, createdAt: user.createdAt })
  })

  router.post('/tokens', authMiddleware, (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const parsed = CreateTokenSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const rawDb = getRawDb()
    const { token, prefix, expiresAt } = createApiKey(rawDb, userId, {
      label: parsed.data.label,
      expiresInSeconds: parsed.data.expiresInSeconds,
    })
    recordAuditEvent(rawDb, { actorUserId: userId, action: 'token.create', target: prefix })
    res.json({ token, prefix, expiresAt })
  })

  router.get('/tokens', authMiddleware, (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const keys = listApiKeys(getRawDb(), userId)
    res.json({ keys })
  })

  router.delete('/tokens/:prefix', authMiddleware, (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const prefix = String(req.params.prefix)
    if (prefix.length < 8) {
      res.status(400).json({ error: 'Token prefix must be at least 8 characters' })
      return
    }
    const rawDb = getRawDb()
    const revoked = revokeApiKeyByPrefix(rawDb, userId, prefix)
    if (revoked === 0) {
      res.status(404).json({ error: 'No matching API key found' })
      return
    }
    recordAuditEvent(rawDb, { actorUserId: userId, action: 'token.revoke', target: prefix })
    res.json({ revoked })
  })

  // SSO identity self-service (Phase 124 / multi-tenant-auth §5 Phase C). Linking
  // a new identity is operator-only via `gitsema auth sso link` (see sso.ts's
  // header for why) — these routes only let a logged-in user view or unlink
  // identities already linked to their own account.
  router.get('/sso', authMiddleware, (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    res.json({ identities: listSsoIdentitiesForUser(getRawDb(), userId) })
  })

  router.delete('/sso/:provider/:externalId', authMiddleware, (req, res) => {
    const userId = requireUserId(req, res)
    if (userId === undefined) return
    const provider = String(req.params.provider)
    const externalId = String(req.params.externalId)
    const identities = listSsoIdentitiesForUser(getRawDb(), userId)
    const owns = identities.some((i) => i.provider === provider && i.externalId === externalId)
    if (!owns) {
      res.status(404).json({ error: 'No matching SSO identity linked to this account' })
      return
    }
    const removed = unlinkSsoIdentity(getRawDb(), provider, externalId)
    res.json({ removed })
  })

  return router
}
