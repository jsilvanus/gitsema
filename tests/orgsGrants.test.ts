/**
 * Unit tests for orgs, personal groups, and repo/branch grants
 * (Phase 123 / multi-tenant-auth §5 Phase B).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, type DbSession } from '../src/core/db/sqlite.js'
import { createUser } from '../src/core/auth/identity.js'
import {
  createOrg,
  getOrgById,
  getOrgByName,
  addOrgMember,
  removeOrgMember,
  getOrgMembership,
  isOrgAdmin,
  listOrgsForUser,
  listOrgMembers,
  provisionPersonalOrg,
  getPersonalOrgForUser,
  maybeProvisionPersonalOrg,
  isPersonalGroupsEnabled,
  PersonalOrgImmutableError,
} from '../src/core/auth/orgs.js'
import {
  createGrant,
  revokeGrant,
  listGrants,
  listGrantsForUser,
  resolveUserRepoAccess,
  roleSatisfies,
  moveRepoToOrg,
  getRepoOrgId,
} from '../src/core/auth/grants.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.GITSEMA_PERSONAL_GROUPS
})

function setupDb(): DbSession {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-orgs-'))
  tmpDirs.push(tmpDir)
  return openDatabaseAt(join(tmpDir, 'test.db'))
}

function addRepoRow(session: DbSession, id: string): void {
  session.rawDb
    .prepare('INSERT INTO repos (id, name, added_at) VALUES (?, ?, ?)')
    .run(id, id, Math.floor(Date.now() / 1000))
}

describe('orgs', () => {
  it('creates a team org and adds/removes members', () => {
    const session = setupDb()
    try {
      const org = createOrg(session.rawDb, 'acme', 'team')
      expect(org.kind).toBe('team')
      expect(getOrgByName(session.rawDb, 'acme')?.id).toBe(org.id)

      const alice = createUser(session.rawDb, 'alice', 'pw')
      addOrgMember(session.rawDb, org.id, alice.id, 'org_admin')
      expect(isOrgAdmin(session.rawDb, org.id, alice.id)).toBe(true)
      expect(getOrgMembership(session.rawDb, org.id, alice.id)?.role).toBe('org_admin')

      const bob = createUser(session.rawDb, 'bob', 'pw')
      addOrgMember(session.rawDb, org.id, bob.id, 'member')
      expect(listOrgMembers(session.rawDb, org.id)).toHaveLength(2)

      removeOrgMember(session.rawDb, org.id, bob.id)
      expect(listOrgMembers(session.rawDb, org.id)).toHaveLength(1)
    } finally {
      session.rawDb.close()
    }
  })

  it('rejects member add/remove on personal orgs', () => {
    const session = setupDb()
    try {
      const alice = createUser(session.rawDb, 'alice', 'pw')
      const org = provisionPersonalOrg(session.rawDb, alice.id, 'alice')
      expect(org.kind).toBe('personal')
      expect(getOrgById(session.rawDb, org.id)?.kind).toBe('personal')

      const bob = createUser(session.rawDb, 'bob', 'pw')
      expect(() => addOrgMember(session.rawDb, org.id, bob.id)).toThrow(PersonalOrgImmutableError)
      expect(() => removeOrgMember(session.rawDb, org.id, alice.id)).toThrow(PersonalOrgImmutableError)
      expect(listOrgMembers(session.rawDb, org.id)).toHaveLength(1)
    } finally {
      session.rawDb.close()
    }
  })

  it('provisions a personal org by default and respects GITSEMA_PERSONAL_GROUPS=false', () => {
    const session = setupDb()
    try {
      expect(isPersonalGroupsEnabled()).toBe(true)
      const alice = createUser(session.rawDb, 'alice', 'pw')
      const org = maybeProvisionPersonalOrg(session.rawDb, alice.id, 'alice')
      expect(org?.kind).toBe('personal')
      expect(getPersonalOrgForUser(session.rawDb, alice.id)?.id).toBe(org?.id)

      // Calling again is idempotent — no duplicate personal org.
      const again = maybeProvisionPersonalOrg(session.rawDb, alice.id, 'alice')
      expect(again?.id).toBe(org?.id)

      process.env.GITSEMA_PERSONAL_GROUPS = 'false'
      expect(isPersonalGroupsEnabled()).toBe(false)
      const bob = createUser(session.rawDb, 'bob', 'pw')
      const bobOrg = maybeProvisionPersonalOrg(session.rawDb, bob.id, 'bob')
      expect(bobOrg).toBeUndefined()
      expect(getPersonalOrgForUser(session.rawDb, bob.id)).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })

  it('lists orgs a user belongs to', () => {
    const session = setupDb()
    try {
      const alice = createUser(session.rawDb, 'alice', 'pw')
      const personal = maybeProvisionPersonalOrg(session.rawDb, alice.id, 'alice')
      const team = createOrg(session.rawDb, 'acme', 'team')
      addOrgMember(session.rawDb, team.id, alice.id, 'member')

      const orgs = listOrgsForUser(session.rawDb, alice.id)
      expect(orgs.map((o) => o.id).sort()).toEqual([personal!.id, team.id].sort())
    } finally {
      session.rawDb.close()
    }
  })
})

describe('repo grants', () => {
  it('creates, lists, and revokes grants', () => {
    const session = setupDb()
    try {
      addRepoRow(session, 'repo1')
      const alice = createUser(session.rawDb, 'alice', 'pw')
      const bob = createUser(session.rawDb, 'bob', 'pw')

      createGrant(session.rawDb, { userId: alice.id, repoId: 'repo1', role: 'write', grantedBy: bob.id })
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1')).toBe('write')
      expect(listGrants(session.rawDb, 'repo1')).toHaveLength(1)
      expect(listGrantsForUser(session.rawDb, alice.id)).toHaveLength(1)

      const revoked = revokeGrant(session.rawDb, alice.id, 'repo1')
      expect(revoked).toBe(1)
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1')).toBeUndefined()
    } finally {
      session.rawDb.close()
    }
  })

  it('re-granting the same user/repo/branch updates the role instead of duplicating', () => {
    const session = setupDb()
    try {
      addRepoRow(session, 'repo1')
      const alice = createUser(session.rawDb, 'alice', 'pw')
      createGrant(session.rawDb, { userId: alice.id, repoId: 'repo1', role: 'read', grantedBy: alice.id })
      createGrant(session.rawDb, { userId: alice.id, repoId: 'repo1', role: 'write', grantedBy: alice.id })
      const grants = listGrants(session.rawDb, 'repo1')
      expect(grants).toHaveLength(1)
      expect(grants[0].role).toBe('write')
    } finally {
      session.rawDb.close()
    }
  })

  it('matches branch_pattern via minimatch glob and falls back to all-branches grants', () => {
    const session = setupDb()
    try {
      addRepoRow(session, 'repo1')
      const alice = createUser(session.rawDb, 'alice', 'pw')
      createGrant(session.rawDb, { userId: alice.id, repoId: 'repo1', role: 'read', branchPattern: 'release/*', grantedBy: alice.id })

      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1', 'release/1.0')).toBe('read')
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1', 'main')).toBeUndefined()
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1')).toBeUndefined()

      // An all-branches grant applies regardless of the requested branch.
      createGrant(session.rawDb, { userId: alice.id, repoId: 'repo1', role: 'write', branchPattern: null, grantedBy: alice.id })
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1', 'main')).toBe('write')
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1')).toBe('write')
    } finally {
      session.rawDb.close()
    }
  })

  it('resolves the highest applicable role across multiple grants', () => {
    const session = setupDb()
    try {
      addRepoRow(session, 'repo1')
      const alice = createUser(session.rawDb, 'alice', 'pw')
      createGrant(session.rawDb, { userId: alice.id, repoId: 'repo1', role: 'read', branchPattern: null, grantedBy: alice.id })
      createGrant(session.rawDb, { userId: alice.id, repoId: 'repo1', role: 'owner', branchPattern: 'main', grantedBy: alice.id })
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1', 'main')).toBe('owner')
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1', 'dev')).toBe('read')
    } finally {
      session.rawDb.close()
    }
  })

  it('roleSatisfies ranks owner > write > read', () => {
    expect(roleSatisfies('owner', 'read')).toBe(true)
    expect(roleSatisfies('write', 'owner')).toBe(false)
    expect(roleSatisfies(undefined, 'read')).toBe(false)
    expect(roleSatisfies('read', 'read')).toBe(true)
  })

  it('moves a repo to a different org while grants survive untouched', () => {
    const session = setupDb()
    try {
      addRepoRow(session, 'repo1')
      const alice = createUser(session.rawDb, 'alice', 'pw')
      createGrant(session.rawDb, { userId: alice.id, repoId: 'repo1', role: 'owner', grantedBy: alice.id })
      const org = createOrg(session.rawDb, 'acme', 'team')

      expect(getRepoOrgId(session.rawDb, 'repo1')).toBeNull()
      moveRepoToOrg(session.rawDb, 'repo1', org.id)
      expect(getRepoOrgId(session.rawDb, 'repo1')).toBe(org.id)
      expect(resolveUserRepoAccess(session.rawDb, alice.id, 'repo1')).toBe('owner')

      moveRepoToOrg(session.rawDb, 'repo1', null)
      expect(getRepoOrgId(session.rawDb, 'repo1')).toBeNull()
    } finally {
      session.rawDb.close()
    }
  })
})
