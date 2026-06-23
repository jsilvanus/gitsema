/**
 * Unit tests for the identity & credentials core (Phase 122 / multi-tenant-auth §5 Phase A).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, type DbSession } from '../src/core/db/sqlite.js'
import {
  createUser,
  getUserByUsername,
  getUserById,
  verifyPassword,
  createSession,
  resolveSessionToken,
  revokeSession,
  createApiKey,
  resolveApiKey,
  listApiKeys,
  revokeApiKeyByPrefix,
  UsernameTakenError,
} from '../src/core/auth/identity.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.GITSEMA_SESSION_TTL_DAYS
})

function setupDb(): DbSession {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-identity-'))
  tmpDirs.push(tmpDir)
  return openDatabaseAt(join(tmpDir, 'test.db'))
}

describe('users', () => {
  it('creates a user and round-trips password verification', () => {
    const session = setupDb()
    try {
      const user = createUser(session.rawDb, 'alice', 's3cret')
      expect(user.username).toBe('alice')
      expect(user.id).toBeGreaterThan(0)

      const verified = verifyPassword(session.rawDb, 'alice', 's3cret')
      expect(verified?.id).toBe(user.id)

      const wrongPassword = verifyPassword(session.rawDb, 'alice', 'wrong')
      expect(wrongPassword).toBeUndefined()

      const unknownUser = verifyPassword(session.rawDb, 'bob', 's3cret')
      expect(unknownUser).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })

  it('throws UsernameTakenError on collision', () => {
    const session = setupDb()
    try {
      createUser(session.rawDb, 'alice', 's3cret')
      expect(() => createUser(session.rawDb, 'alice', 'other')).toThrow(UsernameTakenError)
    } finally {
      session.rawDb.close()
    }
  })

  it('looks up users by username and id', () => {
    const session = setupDb()
    try {
      const user = createUser(session.rawDb, 'alice', 's3cret')
      expect(getUserByUsername(session.rawDb, 'alice')?.id).toBe(user.id)
      expect(getUserById(session.rawDb, user.id)?.username).toBe('alice')
      expect(getUserByUsername(session.rawDb, 'nobody')).toBeUndefined()
      expect(getUserById(session.rawDb, 999999)).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })
})

describe('sessions', () => {
  it('creates a session and resolves it back to the user', () => {
    const session = setupDb()
    try {
      const user = createUser(session.rawDb, 'alice', 's3cret')
      const { token, expiresAt } = createSession(session.rawDb, user.id)
      expect(token).toMatch(/^[0-9a-f]{64}$/)
      expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))

      const resolved = resolveSessionToken(session.rawDb, token)
      expect(resolved?.userId).toBe(user.id)
    } finally {
      session.rawDb.close()
    }
  })

  it('returns undefined for an unknown session token', () => {
    const session = setupDb()
    try {
      expect(resolveSessionToken(session.rawDb, 'not-a-real-token')).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })

  it('expires a session past its TTL and deletes it on resolution', () => {
    process.env.GITSEMA_SESSION_TTL_DAYS = '0.0000001' // effectively instantly expired
    const session = setupDb()
    try {
      const user = createUser(session.rawDb, 'alice', 's3cret')
      const { token } = createSession(session.rawDb, user.id)

      // Force expiry by rewriting expires_at directly to the past.
      session.rawDb.prepare('UPDATE sessions SET expires_at = ?').run(Math.floor(Date.now() / 1000) - 10)

      expect(resolveSessionToken(session.rawDb, token)).toBeUndefined()
      // Resolving again confirms the row was deleted, not just rejected.
      const row = session.rawDb.prepare('SELECT * FROM sessions').get()
      expect(row).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })

  it('revokes a session by token', () => {
    const session = setupDb()
    try {
      const user = createUser(session.rawDb, 'alice', 's3cret')
      const { token } = createSession(session.rawDb, user.id)
      revokeSession(session.rawDb, token)
      expect(resolveSessionToken(session.rawDb, token)).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })
})

describe('API keys', () => {
  it('creates an API key and resolves it back to the user id', () => {
    const session = setupDb()
    try {
      const user = createUser(session.rawDb, 'alice', 's3cret')
      const { token, prefix, expiresAt } = createApiKey(session.rawDb, user.id, { label: 'ci' })
      expect(token).toMatch(/^[0-9a-f]{64}$/)
      expect(prefix).toBe(token.slice(0, 8))
      expect(expiresAt).toBeNull()

      expect(resolveApiKey(session.rawDb, token)).toBe(user.id)
    } finally {
      session.rawDb.close()
    }
  })

  it('returns undefined for an unknown API key', () => {
    const session = setupDb()
    try {
      expect(resolveApiKey(session.rawDb, 'not-a-real-key')).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })

  it('rejects an API key past its hard expiry', () => {
    const session = setupDb()
    try {
      const user = createUser(session.rawDb, 'alice', 's3cret')
      const { token } = createApiKey(session.rawDb, user.id, { expiresInSeconds: -10 })
      expect(resolveApiKey(session.rawDb, token)).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })

  it('lists API keys for a user in creation order', () => {
    const session = setupDb()
    try {
      const user = createUser(session.rawDb, 'alice', 's3cret')
      createApiKey(session.rawDb, user.id, { label: 'first' })
      createApiKey(session.rawDb, user.id, { label: 'second' })
      const keys = listApiKeys(session.rawDb, user.id)
      expect(keys).toHaveLength(2)
      expect(keys[0].label).toBe('first')
      expect(keys[1].label).toBe('second')
      expect(keys[0].revokedAt).toBeNull()
    } finally {
      session.rawDb.close()
    }
  })

  it('revokes an API key by prefix, scoped to the owning user', () => {
    const session = setupDb()
    try {
      const alice = createUser(session.rawDb, 'alice', 's3cret')
      const bob = createUser(session.rawDb, 'bob', 's3cret')
      const { token, prefix } = createApiKey(session.rawDb, alice.id)

      // bob cannot revoke alice's key
      expect(revokeApiKeyByPrefix(session.rawDb, bob.id, prefix)).toBe(0)
      expect(resolveApiKey(session.rawDb, token)).toBe(alice.id)

      // alice can revoke her own key
      expect(revokeApiKeyByPrefix(session.rawDb, alice.id, prefix)).toBe(1)
      expect(resolveApiKey(session.rawDb, token)).toBeUndefined()

      // revoking again finds nothing (already revoked)
      expect(revokeApiKeyByPrefix(session.rawDb, alice.id, prefix)).toBe(0)
    } finally {
      session.rawDb.close()
    }
  })
})
