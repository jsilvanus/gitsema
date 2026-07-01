/**
 * Integration tests for Phase 137 (per-level result-list separation for
 * `code-search`).
 *
 * `code-search`'s default `--level symbol` sets *both* `searchChunks` and
 * `searchSymbols` simultaneously — unlike `search`, where multi-level is an
 * opt-in combination, every default `code-search` call hits the same
 * cross-pool crowding-out condition Phase 136 fixed for `search`: chunk and
 * symbol candidates embed differently-framed text (raw excerpt vs.
 * `buildEnrichedText()`-wrapped code), so their cosine scores aren't on a
 * directly comparable scale, and a file whose best evidence is chunk-framed
 * can get crowded out of `topK` by files whose best evidence is
 * symbol-framed (or vice versa).
 *
 * These tests build a tiny synthetic index directly via raw SQL (mirroring
 * `searchLevelSeparation.test.ts`'s approach) so the crowding-out behavior is
 * fully deterministic, and separately prove the per-blob dedup invariant
 * that makes *within-pool* duplication structurally impossible regardless of
 * which pool(s) are searched.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession } from '../../src/core/db/sqlite.js'
import { vectorSearch } from '../../src/core/search/analysis/vectorSearch.js'
import { resolveExtraLevels, isMultiLevelActive } from '../../src/cli/commands/search.js'

const MODEL = 'mock-model'
const DIM = 4

function vec(components: number[]): Buffer {
  return Buffer.from(new Float32Array(components).buffer)
}

let dir: string
let dbPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitsema-code-search-level-sep-'))
  dbPath = join(dir, 'test.db')
  const session = openDatabaseAt(dbPath)
  const { rawDb } = session
  const now = Math.floor(Date.now() / 1000)

  // Two symbol-level blobs, both strongly aligned with the query vector [1,0,0,0].
  const symbolBlobs = [
    { hash: 'symblob1'.padEnd(40, '1'), score: [0.95, 0.05, 0, 0], name: 'validateToken' },
    { hash: 'symblob2'.padEnd(40, '2'), score: [0.9, 0.1, 0, 0], name: 'parseHeader' },
  ]
  let symbolId = 1
  for (const b of symbolBlobs) {
    rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run(b.hash, 10, now)
    rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run(b.hash, `${b.hash}.ts`)
    rawDb.prepare(
      'INSERT INTO symbols (id, blob_hash, start_line, end_line, symbol_name, symbol_kind, language) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(symbolId, b.hash, 1, 10, b.name, 'function', 'typescript')
    rawDb.prepare('INSERT INTO symbol_embeddings (symbol_id, model, dimensions, vector) VALUES (?, ?, ?, ?)')
      .run(symbolId, MODEL, DIM, vec(b.score))
    symbolId++
  }

  // One chunk-level blob whose *chunk* embedding is only weakly aligned with
  // the query — well below every symbol above — but is the only chunk-level
  // candidate at all, so it should never be crowded out of the chunk list.
  const chunkBlobHash = 'chunkblob'.padEnd(40, '9')
  rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run(chunkBlobHash, 10, now)
  rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run(chunkBlobHash, 'weak-chunk.ts')
  const chunkId = rawDb.prepare('INSERT INTO chunks (blob_hash, start_line, end_line) VALUES (?, ?, ?)')
    .run(chunkBlobHash, 1, 5).lastInsertRowid as number
  rawDb.prepare('INSERT INTO chunk_embeddings (chunk_id, model, dimensions, vector) VALUES (?, ?, ?, ?)')
    .run(chunkId, MODEL, DIM, vec([0.4, 0.05, 0, 0]))

  // A blob that has BOTH a chunk embedding and a symbol embedding, both
  // pointing at the query — used to prove the per-blob dedup invariant: this
  // blob must appear at most once in any single vectorSearch() call, no
  // matter how many pools it has candidates in.
  const dualBlobHash = 'dualblob'.padEnd(40, '7')
  rawDb.prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run(dualBlobHash, 10, now)
  rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run(dualBlobHash, 'dual.ts')
  const dualChunkId = rawDb.prepare('INSERT INTO chunks (blob_hash, start_line, end_line) VALUES (?, ?, ?)')
    .run(dualBlobHash, 1, 8).lastInsertRowid as number
  rawDb.prepare('INSERT INTO chunk_embeddings (chunk_id, model, dimensions, vector) VALUES (?, ?, ?, ?)')
    .run(dualChunkId, MODEL, DIM, vec([0.8, 0.1, 0, 0]))
  rawDb.prepare(
    'INSERT INTO symbols (id, blob_hash, start_line, end_line, symbol_name, symbol_kind, language) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(symbolId, dualBlobHash, 1, 8, 'dualFn', 'function', 'typescript')
  rawDb.prepare('INSERT INTO symbol_embeddings (symbol_id, model, dimensions, vector) VALUES (?, ?, ?, ?)')
    .run(symbolId, MODEL, DIM, vec([0.85, 0.1, 0, 0]))

  session.rawDb.close()
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('code-search: per-blob dedup invariant (Phase 137)', () => {
  it('a blob with both chunk and symbol candidates appears at most once, in a single merged call', async () => {
    const session = openDatabaseAt(dbPath)
    const query = [1, 0, 0, 0]

    const results = await withDbSession(session, () =>
      vectorSearch(query, { topK: 10, model: MODEL, searchChunks: true, searchSymbols: true, includeFiles: false }),
    )

    const dualBlobHash = 'dualblob'.padEnd(40, '7')
    const dualMatches = results.filter((r) => r.blobHash === dualBlobHash)
    expect(dualMatches).toHaveLength(1)

    // Every blob hash across the whole result set is unique — the
    // structural guarantee `bestByBlob` (vectorSearch.ts) provides
    // regardless of which pools contributed candidates.
    const hashes = results.map((r) => r.blobHash)
    expect(new Set(hashes).size).toBe(hashes.length)
    session.rawDb.close()
  })

  it('a blob with both chunk and symbol candidates appears at most once per isolated per-level call too', async () => {
    const session = openDatabaseAt(dbPath)
    const query = [1, 0, 0, 0]

    const { chunkResults, symbolResults } = await withDbSession(session, async () => ({
      chunkResults: await vectorSearch(query, { topK: 10, model: MODEL, searchChunks: true, includeFiles: false }),
      symbolResults: await vectorSearch(query, { topK: 10, model: MODEL, searchSymbols: true, includeFiles: false }),
    }))

    const dualBlobHash = 'dualblob'.padEnd(40, '7')
    expect(chunkResults.filter((r) => r.blobHash === dualBlobHash)).toHaveLength(1)
    expect(symbolResults.filter((r) => r.blobHash === dualBlobHash)).toHaveLength(1)
    session.rawDb.close()
  })
})

describe('code-search: chunk-vs-symbol pool isolation (Phase 137)', () => {
  it('merged call (searchChunks + searchSymbols together, code-search default) crowds the weak chunk out of a small topK', async () => {
    const session = openDatabaseAt(dbPath)
    const query = [1, 0, 0, 0]

    const results = await withDbSession(session, () =>
      vectorSearch(query, { topK: 2, model: MODEL, searchChunks: true, searchSymbols: true, includeFiles: false }),
    )

    expect(results).toHaveLength(2)
    // Both symbol candidates (higher-scoring) win the shared topK=2 cutoff;
    // the weak, lone chunk candidate never makes it in.
    expect(results.every((r) => r.kind !== 'chunk' || r.blobHash === 'dualblob'.padEnd(40, '7'))).toBe(true)
    const weakChunkHash = 'chunkblob'.padEnd(40, '9')
    expect(results.some((r) => r.blobHash === weakChunkHash)).toBe(false)
    session.rawDb.close()
  })

  it('isolated per-level calls (Phase 137 default) keep the chunk list independent of the symbol list', async () => {
    const session = openDatabaseAt(dbPath)
    const query = [1, 0, 0, 0]

    const { chunkResults, symbolResults } = await withDbSession(session, async () => ({
      chunkResults: await vectorSearch(query, { topK: 2, model: MODEL, searchChunks: true, includeFiles: false }),
      symbolResults: await vectorSearch(query, { topK: 2, model: MODEL, searchSymbols: true, includeFiles: false }),
    }))

    // The weak chunk candidate survives its own isolated topK cutoff.
    const weakChunkHash = 'chunkblob'.padEnd(40, '9')
    expect(chunkResults.some((r) => r.blobHash === weakChunkHash)).toBe(true)

    // Both strong symbol candidates survive their own isolated topK cutoff.
    expect(symbolResults).toHaveLength(2)
    expect(symbolResults.every((r) => r.kind === 'symbol')).toBe(true)
    session.rawDb.close()
  })

  it('resolveExtraLevels/isMultiLevelActive mark code-search\'s default level as multi-level active', () => {
    // code-search's default level ('symbol') always sets both flags true —
    // no opt-in combination needed, unlike `search`.
    const levels = resolveExtraLevels(true, true, false)
    expect(levels.map((l) => l.name)).toEqual(['chunk', 'symbol'])
    expect(isMultiLevelActive(levels)).toBe(true)
  })
})
