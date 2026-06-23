/**
 * HTTP integration tests for /api/v1/auth/* (Phase 122 / multi-tenant-auth §5 Phase A)
 * and the dual-auth-path precedence in authMiddleware (session/API-key vs. the
 * legacy GITSEMA_SERVE_KEY).
 *
 * Pattern mirrors tests/serverRoutes.test.ts: a real Express app (createApp)
 * backed by an in-memory SQLite DB, supertest for HTTP assertions.
 */

import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/core/db/sqlite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/db/sqlite.js')>()
  const session = actual.openDatabaseAt(':memory:')
  return {
    ...actual,
    getActiveSession: () => session,
    getRawDb: () => session.rawDb,
    db: session.db,
  }
})

import { createApp } from '../src/server/app.js'
import { getRawDb } from '../src/core/db/sqlite.js'
import { createUser, getUserByUsername } from '../src/core/auth/identity.js'
import { linkSsoIdentity } from '../src/core/auth/sso.js'
import { listAuditLog } from '../src/core/auth/auditLog.js'
import type { EmbeddingProvider } from '../src/core/embedding/provider.js'

const mockProvider: EmbeddingProvider = {
  model: 'mock',
  embed: async () => [0.1, 0.2, 0.3, 0.4],
  embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
  dimensions: 4,
}

let app: ReturnType<typeof createApp>

beforeAll(async () => {
  app = createApp({ textProvider: mockProvider })
})

beforeEach(() => {
  createUser(getRawDb(), 'alice', 'correct-password')
})

afterEach(() => {
  delete process.env.GITSEMA_SERVE_KEY
  delete process.env.GITSEMA_SSO_PROVIDERS
  const rawDb = getRawDb()
  rawDb.exec(
    'DELETE FROM users; DELETE FROM sessions; DELETE FROM api_keys; DELETE FROM sso_identities; DELETE FROM audit_log;',
  )
})

describe('POST /api/v1/auth/login', () => {
  it('returns a session token for valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'correct-password' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body.username).toBe('alice')
    expect(res.body).toHaveProperty('expiresAt')
  })

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'wrong-password' })
    expect(res.status).toBe(401)
  })

  it('returns 401 for unknown username', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nobody', password: 'whatever' })
    expect(res.status).toBe(401)
  })

  it('records login.success and login.failure audit events', async () => {
    await request(app).post('/api/v1/auth/login').send({ username: 'alice', password: 'correct-password' })
    await request(app).post('/api/v1/auth/login').send({ username: 'alice', password: 'wrong-password' })
    const entries = listAuditLog(getRawDb())
    const actions = entries.map((e) => e.action)
    expect(actions).toContain('login.success')
    expect(actions).toContain('login.failure')
  })

  it('returns 400 for a malformed body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: '' })
    expect(res.status).toBe(400)
  })

  it('is reachable with no Authorization header even when GITSEMA_SERVE_KEY is set', async () => {
    process.env.GITSEMA_SERVE_KEY = 'some-global-key'
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'correct-password' })
    expect(res.status).toBe(200)
  })
})

async function loginAsAlice(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'alice', password: 'correct-password' })
  return res.body.token as string
}

describe('GET /api/v1/auth/whoami', () => {
  it('resolves the calling user identity from a session token', async () => {
    const token = await loginAsAlice()
    const res = await request(app)
      .get('/api/v1/auth/whoami')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.username).toBe('alice')
  })

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/v1/auth/whoami')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a revoked/unknown token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/whoami')
      .set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session token used to call it', async () => {
    const token = await loginAsAlice()
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
    expect(logoutRes.status).toBe(200)

    const whoamiRes = await request(app)
      .get('/api/v1/auth/whoami')
      .set('Authorization', `Bearer ${token}`)
    expect(whoamiRes.status).toBe(401)
  })
})

describe('API key routes', () => {
  it('mints, lists, and revokes an API key for the logged-in user', async () => {
    const sessionToken = await loginAsAlice()

    const createRes = await request(app)
      .post('/api/v1/auth/tokens')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ label: 'ci-key' })
    expect(createRes.status).toBe(200)
    expect(createRes.body).toHaveProperty('token')
    const apiKeyToken = createRes.body.token as string
    const prefix = createRes.body.prefix as string

    // The minted API key itself authenticates requests, independent of the session.
    const whoamiRes = await request(app)
      .get('/api/v1/auth/whoami')
      .set('Authorization', `Bearer ${apiKeyToken}`)
    expect(whoamiRes.status).toBe(200)
    expect(whoamiRes.body.username).toBe('alice')

    const listRes = await request(app)
      .get('/api/v1/auth/tokens')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(listRes.status).toBe(200)
    expect(listRes.body.keys).toHaveLength(1)
    expect(listRes.body.keys[0].label).toBe('ci-key')

    const revokeRes = await request(app)
      .delete(`/api/v1/auth/tokens/${prefix}`)
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(revokeRes.status).toBe(200)
    expect(revokeRes.body.revoked).toBe(1)

    // The revoked API key no longer authenticates.
    const afterRevoke = await request(app)
      .get('/api/v1/auth/whoami')
      .set('Authorization', `Bearer ${apiKeyToken}`)
    expect(afterRevoke.status).toBe(401)

    const auditEntries = listAuditLog(getRawDb())
    const actions = auditEntries.map((e) => e.action)
    expect(actions).toContain('token.create')
    expect(actions).toContain('token.revoke')
  })

  it('returns 400 for a too-short prefix on revoke', async () => {
    const sessionToken = await loginAsAlice()
    const res = await request(app)
      .delete('/api/v1/auth/tokens/short')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(res.status).toBe(400)
  })

  it('returns 404 when revoking a prefix with no matching key', async () => {
    const sessionToken = await loginAsAlice()
    const res = await request(app)
      .delete('/api/v1/auth/tokens/deadbeef')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(res.status).toBe(404)
  })
})

describe('SSO identity self-service routes', () => {
  it('lists identities linked to the calling user', async () => {
    process.env.GITSEMA_SSO_PROVIDERS = 'google'
    const alice = getUserByUsername(getRawDb(), 'alice')
    linkSsoIdentity(getRawDb(), { provider: 'google', externalId: 'sub-1', userId: alice!.id })
    const sessionToken = await loginAsAlice()

    const res = await request(app)
      .get('/api/v1/auth/sso')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(res.status).toBe(200)
    expect(res.body.identities).toHaveLength(1)
    expect(res.body.identities[0]).toMatchObject({ provider: 'google', externalId: 'sub-1' })
  })

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/v1/auth/sso')
    expect(res.status).toBe(401)
  })

  it('unlinks an identity owned by the calling user', async () => {
    process.env.GITSEMA_SSO_PROVIDERS = 'google'
    const alice = getUserByUsername(getRawDb(), 'alice')
    linkSsoIdentity(getRawDb(), { provider: 'google', externalId: 'sub-1', userId: alice!.id })
    const sessionToken = await loginAsAlice()

    const res = await request(app)
      .delete('/api/v1/auth/sso/google/sub-1')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(res.status).toBe(200)
    expect(res.body.removed).toBe(1)

    const listRes = await request(app)
      .get('/api/v1/auth/sso')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(listRes.body.identities).toHaveLength(0)
  })

  it('returns 404 when unlinking an identity not linked to the calling user', async () => {
    process.env.GITSEMA_SSO_PROVIDERS = 'google'
    const bob = createUser(getRawDb(), 'bob', 'bobs-password')
    linkSsoIdentity(getRawDb(), { provider: 'google', externalId: 'sub-bob', userId: bob.id })
    const sessionToken = await loginAsAlice()

    const res = await request(app)
      .delete('/api/v1/auth/sso/google/sub-bob')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(res.status).toBe(404)
  })
})

describe('dual-auth-path precedence', () => {
  it('accepts a user session token even when GITSEMA_SERVE_KEY is also set', async () => {
    process.env.GITSEMA_SERVE_KEY = 'some-global-key'
    const sessionToken = await loginAsAlice()
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', `Bearer ${sessionToken}`)
    expect(res.status).toBe(200)
  })

  it('still accepts the legacy global key when no session/API key matches', async () => {
    process.env.GITSEMA_SERVE_KEY = 'some-global-key'
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer some-global-key')
    expect(res.status).toBe(200)
  })

  it('rejects a request with neither a valid session/API key nor the global key', async () => {
    process.env.GITSEMA_SERVE_KEY = 'some-global-key'
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer garbage')
    expect(res.status).toBe(401)
  })
})
