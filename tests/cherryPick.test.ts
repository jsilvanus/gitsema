import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { suggestCherryPicks } from '../src/core/search/cherryPick.js'

function bufFromArray(arr: number[]) {
  return Buffer.from(new Float32Array(arr).buffer)
}

describe('suggestCherryPicks', () => {
  it('finds commits similar to query embedding', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-cherrypick-'))
    const dbPath = join(tmpDir, 'test.db')
    const session = openDatabaseAt(dbPath)

    // Insert commits and commit_embeddings
    session.rawDb.prepare('INSERT OR IGNORE INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)')
      .run('commit1', 1, 'fix auth')
    session.rawDb.prepare('INSERT OR IGNORE INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)')
      .run('commit2', 1, 'update docs')

    session.rawDb.prepare('INSERT INTO commit_embeddings (commit_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
      .run('commit1', 'm', 3, bufFromArray([1,0,0]))
    session.rawDb.prepare('INSERT INTO commit_embeddings (commit_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)')
      .run('commit2', 'm', 3, bufFromArray([0,1,0]))

    const queryEmb = [1,0,0]
    const results = await withDbSession(session, async () => suggestCherryPicks(queryEmb as any, { topK: 5, model: 'm' }))
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].commitHash).toBe('commit1')
    session.rawDb.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
