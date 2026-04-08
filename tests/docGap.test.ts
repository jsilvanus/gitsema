import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { computeDocGap } from '../src/core/search/docGap.js'

function bufFromArray(arr: number[]) {
  return Buffer.from(new Float32Array(arr).buffer)
}

describe('computeDocGap', () => {
  let tmpDir: string
  let session: any

  it('ranks code files by lack of documentation similarity', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-docgap-'))
    const dbPath = join(tmpDir, 'test.db')
    session = openDatabaseAt(dbPath)

    // Insert blobs
    session.rawDb.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)')
      .run('codeA', 10, 1)
    session.rawDb.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)')
      .run('codeB', 10, 1)
    session.rawDb.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)')
      .run('doc1', 10, 1)

    // Paths: classify by extension
    session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('codeA', 'src/a.py')
    session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('codeB', 'src/b.py')
    session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('doc1', 'README.md')

    // Embeddings: doc vector aligned with axis 0, codeA orthogonal, codeB aligned
    session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector, file_type) VALUES (?, ?, ?, ?, ?)')
      .run('doc1', 'm', 4, bufFromArray([1,0,0,0]), 'text')
    session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector, file_type) VALUES (?, ?, ?, ?, ?)')
      .run('codeA', 'm', 4, bufFromArray([0,1,0,0]), 'code')
    session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector, file_type) VALUES (?, ?, ?, ?, ?)')
      .run('codeB', 'm', 4, bufFromArray([1,0,0,0]), 'code')

    const results = await withDbSession(session, async () => computeDocGap({ topK: 10 }))

    expect(results.length).toBeGreaterThan(0)
    // codeA has max similarity 0 -> should be first
    expect(results[0].blobHash).toBe('codeA')

    session.rawDb.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
