/**
 * Unit tests for SSO/OIDC identity linking (Phase 124 / multi-tenant-auth §5 Phase C).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, type DbSession } from '../src/core/db/sqlite.js'
import { createUser } from '../src/core/auth/identity.js'
import {
  getAllowedSsoProviders,
  isSsoProviderAllowed,
  linkSsoIdentity,
  unlinkSsoIdentity,
  resolveSsoIdentity,
  listSsoIdentitiesForUser,
  SsoIdentityTakenError,
  SsoProviderNotAllowedError,
} from '../src/core/auth/sso.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.GITSEMA_SSO_PROVIDERS
})

function setupDb(): DbSession {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-sso-'))
  tmpDirs.push(tmpDir)
  return openDatabaseAt(join(tmpDir, 'test.db'))
}

describe('provider allowlist', () => {
  it('is empty by default', () => {
    expect(getAllowedSsoProviders()).toEqual([])
    expect(isSsoProviderAllowed('google')).toBe(false)
  })

  it('parses GITSEMA_SSO_PROVIDERS as a comma-separated list', () => {
    process.env.GITSEMA_SSO_PROVIDERS = 'google, okta ,github'
    expect(getAllowedSsoProviders()).toEqual(['google', 'okta', 'github'])
    expect(isSsoProviderAllowed('okta')).toBe(true)
    expect(isSsoProviderAllowed('azure')).toBe(false)
  })
})

describe('linkSsoIdentity / unlinkSsoIdentity / resolveSsoIdentity / listSsoIdentitiesForUser', () => {
  it('throws SsoProviderNotAllowedError for a non-allowlisted provider', () => {
    const session = setupDb()
    try {
      const alice = createUser(session.rawDb, 'alice', 'pw')
      expect(() => linkSsoIdentity(session.rawDb, { provider: 'google', externalId: 'sub-1', userId: alice.id })).toThrow(
        SsoProviderNotAllowedError,
      )
    } finally {
      session.rawDb.close()
    }
  })

  it('links, resolves, lists, and unlinks an identity', () => {
    process.env.GITSEMA_SSO_PROVIDERS = 'google'
    const session = setupDb()
    try {
      const alice = createUser(session.rawDb, 'alice', 'pw')
      const identity = linkSsoIdentity(session.rawDb, { provider: 'google', externalId: 'sub-1', userId: alice.id })
      expect(identity.provider).toBe('google')
      expect(identity.externalId).toBe('sub-1')
      expect(identity.userId).toBe(alice.id)

      expect(resolveSsoIdentity(session.rawDb, 'google', 'sub-1')).toBe(alice.id)
      expect(resolveSsoIdentity(session.rawDb, 'google', 'unknown-sub')).toBeUndefined()

      const list = listSsoIdentitiesForUser(session.rawDb, alice.id)
      expect(list).toHaveLength(1)
      expect(list[0].externalId).toBe('sub-1')

      const removed = unlinkSsoIdentity(session.rawDb, 'google', 'sub-1')
      expect(removed).toBe(1)
      expect(resolveSsoIdentity(session.rawDb, 'google', 'sub-1')).toBeUndefined()
      expect(listSsoIdentitiesForUser(session.rawDb, alice.id)).toHaveLength(0)
    } finally {
      session.rawDb.close()
    }
  })

  it('throws SsoIdentityTakenError when linking an already-linked (provider, externalId)', () => {
    process.env.GITSEMA_SSO_PROVIDERS = 'google'
    const session = setupDb()
    try {
      const alice = createUser(session.rawDb, 'alice', 'pw')
      const bob = createUser(session.rawDb, 'bob', 'pw')
      linkSsoIdentity(session.rawDb, { provider: 'google', externalId: 'sub-1', userId: alice.id })
      expect(() => linkSsoIdentity(session.rawDb, { provider: 'google', externalId: 'sub-1', userId: bob.id })).toThrow(
        SsoIdentityTakenError,
      )
    } finally {
      session.rawDb.close()
    }
  })

  it('unlinking a non-existent identity returns 0', () => {
    const session = setupDb()
    try {
      expect(unlinkSsoIdentity(session.rawDb, 'google', 'nope')).toBe(0)
    } finally {
      session.rawDb.close()
    }
  })
})
