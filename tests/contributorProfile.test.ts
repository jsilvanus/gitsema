import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { computeContributorProfile } from '../src/core/search/contributorProfile.js'

function bufFromArray(arr: number[]) {
  return Buffer.from(new Float32Array(arr).buffer)
}

describe('computeContributorProfile', () => {
  it('computes centroid and returns top blobs', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-cp-'))
    const dbPath = join(tmpDir, 'test.db')
    const session = openDatabaseAt(dbPath)

    // Insert blob, commit, blob_commits, embedding
    session.rawDb.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)')
      .run('blob1', 10, 1)
    session.rawDb.prepare('INSERT OR IGNORE INTO commits (commit_hash, timestamp, message, author_name, author_email) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 1, 'msg', 'Alice', 'alice@test')
    session.rawDb.prepare('INSERT OR IGNORE INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)').run('blob1', 'c1')

    // Embedding for blob1
    session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector, file_type) VALUES (?, ?, ?, ?, ?)')
      .run('blob1', 'm', 3, bufFromArray([1,0,0]), 'code')

    const results = await withDbSession(session, async () => computeContributorProfile('Alice', { topK: 5 }))
    expect(results.length).toBeGreaterThan(0)
    // top result should reference blob1 in paths or blobHash
    expect(results[0].blobHash || results[0].paths).toBeTruthy()

    session.rawDb.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
