/**
 * Unit tests for the identity/authorization audit trail (Phase 125 / multi-tenant-auth §5 Phase D).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, type DbSession } from '../src/core/db/sqlite.js'
import { recordAuditEvent, listAuditLog } from '../src/core/auth/auditLog.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function setupDb(): DbSession {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-audit-'))
  tmpDirs.push(tmpDir)
  return openDatabaseAt(join(tmpDir, 'test.db'))
}

describe('recordAuditEvent / listAuditLog', () => {
  it('records and lists an event newest first', () => {
    const session = setupDb()
    try {
      recordAuditEvent(session.rawDb, { actorUserId: 1, action: 'login.success', target: 'alice' })
      recordAuditEvent(session.rawDb, { actorUserId: 1, action: 'token.create', target: 'abcd1234' })
      const entries = listAuditLog(session.rawDb)
      expect(entries).toHaveLength(2)
      expect(entries[0].action).toBe('token.create')
      expect(entries[1].action).toBe('login.success')
      expect(entries[0].actorUserId).toBe(1)
      expect(entries[0].target).toBe('abcd1234')
    } finally {
      session.rawDb.close()
    }
  })

  it('filters by orgId', () => {
    const session = setupDb()
    try {
      recordAuditEvent(session.rawDb, { action: 'org.member.add', orgId: 1, target: 'alice' })
      recordAuditEvent(session.rawDb, { action: 'org.member.add', orgId: 2, target: 'bob' })
      const entries = listAuditLog(session.rawDb, { orgId: 1 })
      expect(entries).toHaveLength(1)
      expect(entries[0].target).toBe('alice')
    } finally {
      session.rawDb.close()
    }
  })

  it('filters by repoId', () => {
    const session = setupDb()
    try {
      recordAuditEvent(session.rawDb, { action: 'grant.create', repoId: 'repo-a', target: 'alice' })
      recordAuditEvent(session.rawDb, { action: 'grant.create', repoId: 'repo-b', target: 'bob' })
      const entries = listAuditLog(session.rawDb, { repoId: 'repo-a' })
      expect(entries).toHaveLength(1)
      expect(entries[0].target).toBe('alice')
    } finally {
      session.rawDb.close()
    }
  })

  it('respects limit', () => {
    const session = setupDb()
    try {
      for (let i = 0; i < 5; i++) {
        recordAuditEvent(session.rawDb, { action: 'login.success', target: `user${i}` })
      }
      const entries = listAuditLog(session.rawDb, { limit: 2 })
      expect(entries).toHaveLength(2)
    } finally {
      session.rawDb.close()
    }
  })

  it('defaults missing fields to null', () => {
    const session = setupDb()
    try {
      recordAuditEvent(session.rawDb, { action: 'login.failure' })
      const entries = listAuditLog(session.rawDb)
      expect(entries[0].actorUserId).toBeNull()
      expect(entries[0].target).toBeNull()
      expect(entries[0].orgId).toBeNull()
      expect(entries[0].repoId).toBeNull()
    } finally {
      session.rawDb.close()
    }
  })

  it('outlives a deleted org/repo reference (no FK constraints)', () => {
    const session = setupDb()
    try {
      recordAuditEvent(session.rawDb, { action: 'org.repo.moved', orgId: 999, repoId: 'nonexistent-repo' })
      const entries = listAuditLog(session.rawDb, { orgId: 999 })
      expect(entries).toHaveLength(1)
    } finally {
      session.rawDb.close()
    }
  })

  it('never throws, even if the underlying write fails', () => {
    const session = setupDb()
    try {
      session.rawDb.close()
      expect(() => recordAuditEvent(session.rawDb, { action: 'login.success', target: 'alice' })).not.toThrow()
    } finally {
      // already closed above
    }
  })
})
