/**
 * HTTP integration tests for /api/v1/orgs and /api/v1/repos grant routes
 * (Phase 123 / multi-tenant-auth §5 Phase B).
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
import { createUser, createSession } from '../src/core/auth/identity.js'
import { createOrg, addOrgMember, provisionPersonalOrg } from '../src/core/auth/orgs.js'
import { createGrant } from '../src/core/auth/grants.js'
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

function addRepoRow(id: string): void {
  getRawDb()
    .prepare('INSERT INTO repos (id, name, added_at) VALUES (?, ?, ?)')
    .run(id, id, Math.floor(Date.now() / 1000))
}

function loginToken(userId: number): string {
  return createSession(getRawDb(), userId).token
}

afterEach(() => {
  const rawDb = getRawDb()
  rawDb.exec(
    'DELETE FROM repo_grants; DELETE FROM repos; DELETE FROM org_members; DELETE FROM orgs; DELETE FROM sessions; DELETE FROM api_keys; DELETE FROM users;',
  )
})

describe('orgs routes', () => {
  it('creates a team org and makes the creator org_admin', async () => {
    const alice = createUser(getRawDb(), 'alice', 'pw')
    const token = loginToken(alice.id)
    const res = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'acme' })
    expect(res.status).toBe(200)
    expect(res.body.kind).toBe('team')

    const list = await request(app).get('/api/v1/orgs').set('Authorization', `Bearer ${token}`)
    expect(list.body.orgs).toHaveLength(1)
    expect(list.body.orgs[0].role).toBe('org_admin')
  })

  it('requires org_admin to add/remove members', async () => {
    const rawDb = getRawDb()
    const alice = createUser(rawDb, 'alice', 'pw')
    const bob = createUser(rawDb, 'bob', 'pw')
    const carol = createUser(rawDb, 'carol', 'pw')
    const org = createOrg(rawDb, 'acme', 'team')
    addOrgMember(rawDb, org.id, alice.id, 'org_admin')
    addOrgMember(rawDb, org.id, bob.id, 'member')

    const bobToken = loginToken(bob.id)
    const forbidden = await request(app)
      .post(`/api/v1/orgs/${org.id}/members`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ username: 'carol' })
    expect(forbidden.status).toBe(403)

    const aliceToken = loginToken(alice.id)
    const ok = await request(app)
      .post(`/api/v1/orgs/${org.id}/members`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ username: 'carol', role: 'member' })
    expect(ok.status).toBe(200)

    const removed = await request(app)
      .delete(`/api/v1/orgs/${org.id}/members/${carol.id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
    expect(removed.status).toBe(200)
  })

  it('rejects member management on personal orgs with 403', async () => {
    const rawDb = getRawDb()
    const alice = createUser(rawDb, 'alice', 'pw')
    const bob = createUser(rawDb, 'bob', 'pw')
    const personal = provisionPersonalOrg(rawDb, alice.id, 'alice')

    const aliceToken = loginToken(alice.id)
    const res = await request(app)
      .post(`/api/v1/orgs/${personal.id}/members`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ username: 'bob' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/exactly one member/)
    void bob
  })
})

describe('repo grant routes', () => {
  it('allows an owner-grant holder to manage grants and rejects non-owners', async () => {
    const rawDb = getRawDb()
    addRepoRow('repo1')
    const alice = createUser(rawDb, 'alice', 'pw')
    const bob = createUser(rawDb, 'bob', 'pw')
    createGrant(rawDb, { userId: alice.id, repoId: 'repo1', role: 'owner', grantedBy: alice.id })

    const bobToken = loginToken(bob.id)
    const forbidden = await request(app)
      .post('/api/v1/repos/repo1/grants')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ username: 'bob', role: 'read' })
    expect(forbidden.status).toBe(403)

    const aliceToken = loginToken(alice.id)
    const grant = await request(app)
      .post('/api/v1/repos/repo1/grants')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ username: 'bob', role: 'write', branchPattern: 'release/*' })
    expect(grant.status).toBe(200)
    expect(grant.body.role).toBe('write')

    const listed = await request(app).get('/api/v1/repos/repo1/grants').set('Authorization', `Bearer ${aliceToken}`)
    expect(listed.body.grants).toHaveLength(2)

    const revoke = await request(app)
      .delete(`/api/v1/repos/repo1/grants/${bob.id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
    expect(revoke.status).toBe(200)
    expect(revoke.body.revoked).toBe(1)
  })

  it('moves a repo to an org and grants survive', async () => {
    const rawDb = getRawDb()
    addRepoRow('repo1')
    const alice = createUser(rawDb, 'alice', 'pw')
    createGrant(rawDb, { userId: alice.id, repoId: 'repo1', role: 'owner', grantedBy: alice.id })
    const org = createOrg(rawDb, 'acme', 'team')

    const aliceToken = loginToken(alice.id)
    const res = await request(app)
      .post('/api/v1/repos/repo1/move-to-org')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ orgId: org.id })
    expect(res.status).toBe(200)

    const grants = await request(app).get('/api/v1/repos/repo1/grants').set('Authorization', `Bearer ${aliceToken}`)
    expect(grants.body.grants).toHaveLength(1)
  })
})
