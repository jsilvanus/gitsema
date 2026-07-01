/**
 * Integration tests for Phase 136 (distinct per-level search result lists).
 *
 * The bug this phase fixes: `vectorSearch()`'s file/chunk/symbol/module
 * candidate pools were always merged into one shared-cutoff ranked list, so
 * a weaker-scoring level (e.g. a lone matching chunk) could be crowded out
 * entirely by a handful of higher-scoring file-level matches before a caller
 * ever saw it. The fix is the new `includeFiles` option on `vectorSearch()`:
 * set to `false`, a level-specific call gets its own isolated candidate pool
 * and topK cutoff instead of competing against the file-level pool.
 *
 * These tests build a tiny synthetic index directly via raw SQL (rather than
 * running the full indexer/chunker pipeline) so the file vs. chunk score gap
 * — and therefore the crowding-out behavior — is fully deterministic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession } from '../../src/core/db/sqlite.js'
import { vectorSearch } from '../../src/core/search/analysis/vectorSearch.js'

const MODEL = 'mock-model'
const DIM = 4

function vec(components: number[]): Buffer {
  return Buffer.from(new Float32Array(components).buffer)
}

let dir: string
let dbPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitsema-level-sep-'))
  dbPath = join(dir, 'test.db')
  const session = openDatabaseAt(dbPath)
  const { rawDb } = session
  const now = Math.floor(Date.now() / 1000)

  // Three file-level blobs, all strongly aligned with the query vector [1,0,0,0].
  const fileBlobs = [
    { hash: 'file1'.padEnd(40, '1'), score: [0.95, 0.05, 0, 0] },
    { hash: 'file2'.padEnd(40, '2'), score: [0.9, 0.1, 0, 0] },
    { hash: 'file3'.padEnd(40, '3'), score: [0.85, 0.15, 0, 0] },
  ]
  for (const b of fileBlobs) {
    rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run(b.hash, 10, now)
    rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector) VALUES (?, ?, ?, ?)').run(b.hash, MODEL, DIM, vec(b.score))
    rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run(b.hash, `${b.hash}.ts`)
  }

  // One chunk blob whose *chunk* embedding is only weakly aligned with the
  // query — well below every file above — but is the only chunk-level
  // candidate at all, so it should never be crowded out of the chunk list.
  const chunkBlobHash = 'chunkblob'.padEnd(40, '9')
  rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run(chunkBlobHash, 10, now)
  rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run(chunkBlobHash, 'weak-chunk.ts')
  const chunkId = rawDb.prepare('INSERT INTO chunks (blob_hash, start_line, end_line) VALUES (?, ?, ?)')
    .run(chunkBlobHash, 1, 5).lastInsertRowid as number
  rawDb.prepare('INSERT INTO chunk_embeddings (chunk_id, model, dimensions, vector) VALUES (?, ?, ?, ?)')
    .run(chunkId, MODEL, DIM, vec([0.4, 0.05, 0, 0]))

  session.rawDb.close()
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('vectorSearch includeFiles isolation (Phase 136)', () => {
  it('merged call (includeFiles + searchChunks together) crowds the weak chunk out of a small topK', async () => {
    const session = openDatabaseAt(dbPath)
    const query = [1, 0, 0, 0]

    const results = await withDbSession(session, () =>
      vectorSearch(query, { topK: 2, model: MODEL, searchChunks: true, includeFiles: true }),
    )

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.kind !== 'chunk')).toBe(true)
    session.rawDb.close()
  })

  it('isolated per-level calls keep the chunk list independent of the file list', async () => {
    const session = openDatabaseAt(dbPath)
    const query = [1, 0, 0, 0]

    const { fileResults, chunkResults } = await withDbSession(session, async () => ({
      fileResults: await vectorSearch(query, { topK: 2, model: MODEL, includeFiles: true }),
      chunkResults: await vectorSearch(query, { topK: 2, model: MODEL, searchChunks: true, includeFiles: false }),
    }))

    expect(fileResults).toHaveLength(2)
    expect(fileResults.every((r) => r.kind !== 'chunk')).toBe(true)

    // The lone chunk candidate must survive its own isolated topK cutoff.
    expect(chunkResults).toHaveLength(1)
    expect(chunkResults[0].kind).toBe('chunk')
    session.rawDb.close()
  })

  it('includeFiles: false with no other level flags returns an empty pool', async () => {
    const session = openDatabaseAt(dbPath)
    const query = [1, 0, 0, 0]

    const results = await withDbSession(session, () =>
      vectorSearch(query, { topK: 5, model: MODEL, includeFiles: false }),
    )

    expect(results).toEqual([])
    session.rawDb.close()
  })
})
