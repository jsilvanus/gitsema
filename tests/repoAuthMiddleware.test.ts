import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

const mockGetRepo = vi.fn()
const mockResolveUserRepoAccess = vi.fn()

vi.mock('../src/core/indexing/repoRegistry.js', () => ({
  getRepo: (...args: unknown[]) => mockGetRepo(...args),
}))

vi.mock('../src/core/db/sqlite.js', () => ({
  getActiveSession: () => ({ rawDb: 'active-db' }),
  getRawDb: () => 'control-plane-db',
}))

vi.mock('../src/core/auth/grants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/auth/grants.js')>()
  return {
    ...actual,
    resolveUserRepoAccess: (...args: unknown[]) => mockResolveUserRepoAccess(...args),
    // roleSatisfies is pure — use the real one.
  }
})

import { repoAuthMiddleware, isMultiTenantMode } from '../src/server/middleware/repoAuth.js'

function makeReq(opts: {
  body?: unknown
  query?: unknown
  repoId?: string
  userId?: number
  globalKeyAuth?: boolean
  repoTokenScoped?: boolean
}): Request {
  return {
    body: opts.body ?? {},
    query: opts.query ?? {},
    repoId: opts.repoId,
    userId: opts.userId,
    globalKeyAuth: opts.globalKeyAuth,
    repoTokenScoped: opts.repoTokenScoped,
  } as unknown as Request
}

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response
}

const ENV_KEYS = ['GITSEMA_MULTI_TENANT', 'GITSEMA_SERVE_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  mockGetRepo.mockReset()
  mockResolveUserRepoAccess.mockReset()
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('isMultiTenantMode', () => {
  it('is off by default (no key, no flag)', () => {
    expect(isMultiTenantMode()).toBe(false)
  })
  it('is on when GITSEMA_SERVE_KEY is set', () => {
    process.env.GITSEMA_SERVE_KEY = 'secret'
    expect(isMultiTenantMode()).toBe(true)
  })
  it('honors an explicit GITSEMA_MULTI_TENANT=1', () => {
    expect(isMultiTenantMode()).toBe(false)
    process.env.GITSEMA_MULTI_TENANT = '1'
    expect(isMultiTenantMode()).toBe(true)
  })
  it('lets GITSEMA_MULTI_TENANT=0 disable enforcement even with a serve key', () => {
    process.env.GITSEMA_SERVE_KEY = 'secret'
    process.env.GITSEMA_MULTI_TENANT = '0'
    expect(isMultiTenantMode()).toBe(false)
  })
})

describe('repoAuthMiddleware', () => {
  it('passes through unchanged in single-dev mode (no key/flag)', () => {
    const req = makeReq({ body: { repoId: 'private-repo' } })
    const res = makeRes()
    const next = vi.fn() as NextFunction
    repoAuthMiddleware(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(mockGetRepo).not.toHaveBeenCalled()
  })

  describe('multi-tenant mode', () => {
    beforeEach(() => {
      process.env.GITSEMA_MULTI_TENANT = '1'
    })

    it('passes through when no repoId is addressed', () => {
      const req = makeReq({})
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    it('403s an un-granted user reading a private repo', () => {
      mockGetRepo.mockReturnValue({ id: 'private-repo', visibility: 'private' })
      mockResolveUserRepoAccess.mockReturnValue(undefined)
      const req = makeReq({ body: { repoId: 'private-repo' }, userId: 42 })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
    })

    it('403s an unauthenticated caller (no userId) reading a private repo', () => {
      mockGetRepo.mockReturnValue({ id: 'private-repo', visibility: 'private' })
      const req = makeReq({ body: { repoId: 'private-repo' } })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
      expect(mockResolveUserRepoAccess).not.toHaveBeenCalled()
    })

    it('allows a user holding a read grant on a private repo', () => {
      mockGetRepo.mockReturnValue({ id: 'private-repo', visibility: 'private' })
      mockResolveUserRepoAccess.mockReturnValue('read')
      const req = makeReq({ body: { repoId: 'private-repo' }, userId: 42 })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(mockResolveUserRepoAccess).toHaveBeenCalledWith('control-plane-db', 42, 'private-repo')
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    it('allows a user holding a higher (owner) grant', () => {
      mockGetRepo.mockReturnValue({ id: 'private-repo', visibility: 'private' })
      mockResolveUserRepoAccess.mockReturnValue('owner')
      const req = makeReq({ body: { repoId: 'private-repo' }, userId: 7 })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
    })

    it('allows any caller to read a public repo (no grant needed)', () => {
      mockGetRepo.mockReturnValue({ id: 'public-repo', visibility: 'public' })
      const req = makeReq({ body: { repoId: 'public-repo' } })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
      expect(mockResolveUserRepoAccess).not.toHaveBeenCalled()
    })

    it('bypasses the grant check for global-key (admin) auth', () => {
      const req = makeReq({ body: { repoId: 'private-repo' }, globalKeyAuth: true })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(mockGetRepo).not.toHaveBeenCalled()
    })

    it('bypasses the grant check for a legacy per-repo scoped token', () => {
      const req = makeReq({ repoId: 'scoped-repo', repoTokenScoped: true })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(mockGetRepo).not.toHaveBeenCalled()
    })

    it('treats a missing repo mirror row as private (grant required)', () => {
      mockGetRepo.mockReturnValue(null)
      mockResolveUserRepoAccess.mockReturnValue(undefined)
      const req = makeReq({ body: { repoId: 'ghost-repo' }, userId: 1 })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(next).not.toHaveBeenCalled()
    })

    it('resolves the repoId from the query string too', () => {
      mockGetRepo.mockReturnValue({ id: 'q-repo', visibility: 'private' })
      mockResolveUserRepoAccess.mockReturnValue('read')
      const req = makeReq({ query: { repoId: 'q-repo' }, userId: 9 })
      const res = makeRes()
      const next = vi.fn() as NextFunction
      repoAuthMiddleware(req, res, next)
      expect(mockResolveUserRepoAccess).toHaveBeenCalledWith('control-plane-db', 9, 'q-repo')
      expect(next).toHaveBeenCalledTimes(1)
    })
  })
})
