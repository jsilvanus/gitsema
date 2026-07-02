/**
 * Phase 139 — `computeEvolution`'s `branch` filter option.
 *
 * Verifies branch filtering is threaded into the core function itself
 * (rather than post-filtered by callers), matching `computeConceptEvolution`'s
 * existing `branch` parameter.
 *
 * Uses `__setDefaultSessionForTesting` (the same mechanism
 * `tests/setup/defaultSession.ts` uses) rather than `withDbSession`: the
 * module-level `db` export in `src/core/db/sqlite.ts` is a proxy that
 * resolves and caches its target on first property access, so it does not
 * pick up per-call `AsyncLocalStorage` sessions from `withDbSession` once
 * that first resolution has happened — `computeEvolution`/`getFileHistory`
 * (like most of `src/core/search/temporal/evolution.ts`) read through that
 * legacy `db` export, not `getActiveSession().db`. Because of that same
 * proxy caching, all assertions share one session/one `it` block rather than
 * opening a fresh DB per test — a second `openDatabaseAt` call after the
 * proxy has already resolved (and the first DB closed) throws "database
 * connection is not open".
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, __setDefaultSessionForTesting } from '../src/core/db/sqlite.js'
import { computeEvolution } from '../src/core/search/temporal/evolution.js'

function bufFromArray(arr: number[]) {
  return Buffer.from(new Float32Array(arr).buffer)
}

describe('computeEvolution branch filter', () => {
  let tmpDir: string | undefined
  let session: ReturnType<typeof openDatabaseAt> | undefined

  afterEach(() => {
    __setDefaultSessionForTesting(undefined)
    session?.rawDb.close()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
    session = undefined
    tmpDir = undefined
  })

  it('restricts the timeline to blobs present on the given branch, and returns empty for a branch with none of the file\'s blobs', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-evo-branch-'))
    const dbPath = join(tmpDir, 'test.db')
    session = openDatabaseAt(dbPath)
    __setDefaultSessionForTesting(session)

    const insertBlob = session.rawDb.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)')
    const insertPath = session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)')
    const insertCommit = session.rawDb.prepare('INSERT INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)')
    const insertBlobCommit = session.rawDb.prepare('INSERT INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)')
    const insertEmbedding = session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
    const insertBranch = session.rawDb.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)')

    // Three versions of the same file, each a distinct blob/commit.
    insertBlob.run('blobV1', 10, 1)
    insertBlob.run('blobV2', 10, 1)
    insertBlob.run('blobV3', 10, 1)

    insertPath.run('blobV1', 'src/file.ts')
    insertPath.run('blobV2', 'src/file.ts')
    insertPath.run('blobV3', 'src/file.ts')

    insertCommit.run('commit1', 1000, 'v1')
    insertCommit.run('commit2', 2000, 'v2')
    insertCommit.run('commit3', 3000, 'v3')

    insertBlobCommit.run('blobV1', 'commit1')
    insertBlobCommit.run('blobV2', 'commit2')
    insertBlobCommit.run('blobV3', 'commit3')

    insertEmbedding.run('blobV1', 'm', 4, bufFromArray([1, 0, 0, 0]))
    insertEmbedding.run('blobV2', 'm', 4, bufFromArray([0.9, 0.1, 0, 0]))
    insertEmbedding.run('blobV3', 'm', 4, bufFromArray([0, 1, 0, 0]))

    // Only blobV1 and blobV3 are on 'feature/x'; blobV2 is main-only.
    insertBranch.run('blobV1', 'feature/x')
    insertBranch.run('blobV3', 'feature/x')
    insertBranch.run('blobV1', 'main')
    insertBranch.run('blobV2', 'main')
    insertBranch.run('blobV3', 'main')

    const unfiltered = computeEvolution('src/file.ts')
    expect(unfiltered.map((e) => e.blobHash)).toEqual(['blobV1', 'blobV2', 'blobV3'])

    const filtered = computeEvolution('src/file.ts', undefined, { branch: 'feature/x' })
    expect(filtered.map((e) => e.blobHash)).toEqual(['blobV1', 'blobV3'])

    // A second file, present only on 'main' — filtering by an unrelated branch
    // must return an empty timeline rather than falling back to unfiltered.
    session.rawDb.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobOther1', 10, 1)
    session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobOther1', 'src/other.ts')
    session.rawDb.prepare('INSERT INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)').run('commitOther1', 4000, 'other v1')
    session.rawDb.prepare('INSERT INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)').run('blobOther1', 'commitOther1')
    session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)').run('blobOther1', 'm', 4, bufFromArray([0, 0, 1, 0]))
    session.rawDb.prepare('INSERT INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)').run('blobOther1', 'main')

    const emptyFiltered = computeEvolution('src/other.ts', undefined, { branch: 'feature/other' })
    expect(emptyFiltered).toEqual([])
  })
})
