/**
 * Unit tests for superadmin-gated model allow-lists (Phase 129 /
 * locked-model-set-plan.md §5 Phase 2).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, type DbSession } from '../src/core/db/sqlite.js'
import {
  getServerPolicy,
  getOrgPolicy,
  allowServer,
  denyServer,
  allowOrg,
  denyOrg,
  getEffectiveAllowedSet,
  resetServerPolicy,
  resetOrgPolicy,
} from '../src/core/admin/modelPolicy.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function setupDb(): DbSession {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-modelpolicy-'))
  tmpDirs.push(tmpDir)
  return openDatabaseAt(join(tmpDir, 'test.db'))
}

const UNIVERSE = ['a', 'b', 'c']

describe('modelPolicy', () => {
  it('defaults to allow-all when no policy has been set', () => {
    const session = setupDb()
    try {
      expect(getServerPolicy(session.rawDb, 'embedding').active).toBe(false)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(UNIVERSE)
    } finally {
      session.rawDb.close()
    }
  })

  it('allowServer seeds an opt-in set containing only the allowed item', () => {
    const session = setupDb()
    try {
      allowServer(session.rawDb, 'embedding', 'a')
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(['a'])
      allowServer(session.rawDb, 'embedding', 'b')
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(['a', 'b'])
    } finally {
      session.rawDb.close()
    }
  })

  it('denyServer seeds an opt-out set containing every other defined item', () => {
    const session = setupDb()
    try {
      denyServer(session.rawDb, 'embedding', 'a', UNIVERSE)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(['b', 'c'])
      denyServer(session.rawDb, 'embedding', 'b', UNIVERSE)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(['c'])
    } finally {
      session.rawDb.close()
    }
  })

  it('"lock to none" is reachable by denying every defined item', () => {
    const session = setupDb()
    try {
      for (const item of UNIVERSE) denyServer(session.rawDb, 'embedding', item, UNIVERSE)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual([])
    } finally {
      session.rawDb.close()
    }
  })

  it('resetServerPolicy reverts to default-allow-all', () => {
    const session = setupDb()
    try {
      denyServer(session.rawDb, 'embedding', 'a', UNIVERSE)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(['b', 'c'])
      resetServerPolicy(session.rawDb, 'embedding')
      expect(getServerPolicy(session.rawDb, 'embedding').active).toBe(false)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(UNIVERSE)
    } finally {
      session.rawDb.close()
    }
  })

  it('org policy narrows the server-wide set but never widens past it', () => {
    const session = setupDb()
    try {
      denyServer(session.rawDb, 'embedding', 'c', UNIVERSE) // server-wide: a, b
      // org tries to "allow" c, which isn't server-allowed — caller (CLI) is
      // responsible for rejecting that before calling allowOrg; at the
      // policy-engine level, the effective set still intersects with server.
      allowOrg(session.rawDb, 'embedding', 1, 'c')
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', 1, UNIVERSE)).toEqual([])

      resetOrgPolicy(session.rawDb, 'embedding', 1)
      allowOrg(session.rawDb, 'embedding', 1, 'a')
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', 1, UNIVERSE)).toEqual(['a'])
      // Server-wide set unaffected by org narrowing.
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(['a', 'b'])
    } finally {
      session.rawDb.close()
    }
  })

  it('denyOrg seeds an opt-out set relative to the server-allowed set, not the full universe', () => {
    const session = setupDb()
    try {
      denyServer(session.rawDb, 'embedding', 'c', UNIVERSE) // server-wide: a, b
      const serverAllowed = getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)
      denyOrg(session.rawDb, 'embedding', 1, 'a', serverAllowed)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', 1, UNIVERSE)).toEqual(['b'])
    } finally {
      session.rawDb.close()
    }
  })

  it('an org with no explicit policy inherits the server-wide set unmodified', () => {
    const session = setupDb()
    try {
      denyServer(session.rawDb, 'embedding', 'a', UNIVERSE)
      expect(getOrgPolicy(session.rawDb, 'embedding', 1).active).toBe(false)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', 1, UNIVERSE)).toEqual(['b', 'c'])
    } finally {
      session.rawDb.close()
    }
  })

  it('different kinds (embedding/narrator/guide) are independent', () => {
    const session = setupDb()
    try {
      denyServer(session.rawDb, 'embedding', 'a', UNIVERSE)
      expect(getEffectiveAllowedSet(session.rawDb, 'embedding', null, UNIVERSE)).toEqual(['b', 'c'])
      expect(getEffectiveAllowedSet(session.rawDb, 'narrator', null, UNIVERSE)).toEqual(UNIVERSE)
      expect(getEffectiveAllowedSet(session.rawDb, 'guide', null, UNIVERSE)).toEqual(UNIVERSE)
    } finally {
      session.rawDb.close()
    }
  })
})
