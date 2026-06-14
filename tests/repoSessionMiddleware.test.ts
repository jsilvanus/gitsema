import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

const mockGetRepo = vi.fn()
const mockGetOrOpenSessionAtPath = vi.fn()
const mockWithDbSession = vi.fn()

vi.mock('../src/core/indexing/repoRegistry.js', () => ({
  getRegistrySession: () => 'registry-session',
  getRepo: (...args: unknown[]) => mockGetRepo(...args),
}))

vi.mock('../src/core/db/sqlite.js', () => ({
  getOrOpenSessionAtPath: (...args: unknown[]) => mockGetOrOpenSessionAtPath(...args),
  withDbSession: (...args: unknown[]) => mockWithDbSession(...args),
}))

import { repoSessionMiddleware } from '../src/server/middleware/repoSession.js'

function makeReq(opts: { body?: unknown; query?: unknown; repoId?: string }): Request {
  return {
    body: opts.body ?? {},
    query: opts.query ?? {},
    repoId: opts.repoId,
  } as unknown as Request
}

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    on: vi.fn(),
  } as unknown as Response
}

beforeEach(() => {
  mockGetRepo.mockReset()
  mockGetOrOpenSessionAtPath.mockReset()
  mockWithDbSession.mockReset()
})

describe('repoSessionMiddleware', () => {
  it('passes through unchanged when no repoId is present (single-dev mode)', () => {
    const req = makeReq({})
    const res = makeRes()
    const next = vi.fn() as NextFunction

    repoSessionMiddleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(mockGetRepo).not.toHaveBeenCalled()
    expect(mockWithDbSession).not.toHaveBeenCalled()
  })

  it('resolves a repoId from the request body and opens its DB session', () => {
    mockGetRepo.mockReturnValue({ id: 'abc123', dbPath: '/data/repos/abc123/index.db' })
    mockGetOrOpenSessionAtPath.mockReturnValue('session-abc123')
    mockWithDbSession.mockImplementation((_session: unknown, fn: () => Promise<void>) => fn())

    const req = makeReq({ body: { repoId: 'abc123' } })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    repoSessionMiddleware(req, res, next)

    expect(mockGetRepo).toHaveBeenCalledWith('registry-session', 'abc123')
    expect(mockGetOrOpenSessionAtPath).toHaveBeenCalledWith('/data/repos/abc123/index.db')
    expect(mockWithDbSession).toHaveBeenCalledWith('session-abc123', expect.any(Function))
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('resolves a repoId from the query string for GET requests', () => {
    mockGetRepo.mockReturnValue({ id: 'def456', dbPath: '/data/repos/def456/index.db' })
    mockGetOrOpenSessionAtPath.mockReturnValue('session-def456')
    mockWithDbSession.mockImplementation((_session: unknown, fn: () => Promise<void>) => fn())

    const req = makeReq({ query: { repoId: 'def456' } })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    repoSessionMiddleware(req, res, next)

    expect(mockGetRepo).toHaveBeenCalledWith('registry-session', 'def456')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when the resolved repoId is not registered', () => {
    mockGetRepo.mockReturnValue(null)

    const req = makeReq({ body: { repoId: 'unknown' } })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    repoSessionMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(next).not.toHaveBeenCalled()
    expect(mockWithDbSession).not.toHaveBeenCalled()
  })

  it('returns 403 when an explicit repoId conflicts with the token-scoped repoId', () => {
    const req = makeReq({ body: { repoId: 'other-repo' }, repoId: 'scoped-repo' })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    repoSessionMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
    expect(mockGetRepo).not.toHaveBeenCalled()
  })

  it('falls back to the token-scoped repoId when no explicit repoId is supplied', () => {
    mockGetRepo.mockReturnValue({ id: 'scoped-repo', dbPath: '/data/repos/scoped-repo/index.db' })
    mockGetOrOpenSessionAtPath.mockReturnValue('session-scoped')
    mockWithDbSession.mockImplementation((_session: unknown, fn: () => Promise<void>) => fn())

    const req = makeReq({ repoId: 'scoped-repo' })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    repoSessionMiddleware(req, res, next)

    expect(mockGetRepo).toHaveBeenCalledWith('registry-session', 'scoped-repo')
    expect(next).toHaveBeenCalledTimes(1)
  })
})
