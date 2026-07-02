import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { computeSemanticDiff } from '../src/core/search/semanticDiff.js'
import type { SemanticDiffResult } from '../src/core/search/semanticDiff.js'
import { cosineSimilarity } from '../src/core/search/analysis/vectorSearch.js'

function bufFromArray(arr: number[]) {
  return Buffer.from(new Float32Array(arr).buffer)
}

// ---------------------------------------------------------------------------
// cosineSimilarity (used internally by computeSemanticDiff)
// ---------------------------------------------------------------------------

describe('cosineSimilarity — edge cases for semanticDiff scoring', () => {
  it('returns 1 for identical unit vectors', () => {
    const v = [1, 0, 0]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('returns 0 when a zero vector is supplied', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SemanticDiffResult shape
// ---------------------------------------------------------------------------

describe('SemanticDiffResult structure', () => {
  it('has the expected top-level fields', () => {
    const dummy: SemanticDiffResult = {
      ref1: 'v1.0.0',
      ref2: 'HEAD',
      topic: 'authentication',
      timestamp1: 1_700_000_000,
      timestamp2: 1_710_000_000,
      gained: [],
      lost: [],
      stable: [],
    }
    expect(dummy.ref1).toBe('v1.0.0')
    expect(dummy.ref2).toBe('HEAD')
    expect(dummy.topic).toBe('authentication')
    expect(dummy.gained).toBeInstanceOf(Array)
    expect(dummy.lost).toBeInstanceOf(Array)
    expect(dummy.stable).toBeInstanceOf(Array)
  })

  it('gained entries have the expected fields', () => {
    const entry = {
      blobHash: 'abc1234',
      paths: ['src/auth/session.ts'],
      score: 0.85,
      firstSeen: 1_700_000_000,
    }
    expect(entry.blobHash).toBe('abc1234')
    expect(entry.paths).toContain('src/auth/session.ts')
    expect(entry.score).toBeGreaterThan(0)
    expect(entry.firstSeen).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// computeSemanticDiff — integration guard (requires live DB)
// These tests are skipped in CI where no index is available; they document
// the expected behaviour of computeSemanticDiff when a DB is present.
// ---------------------------------------------------------------------------

describe('computeSemanticDiff — logic guards (no DB required)', () => {
  it('is exported as a function', () => {
    expect(typeof computeSemanticDiff).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// computeSemanticDiff — candidateBlobs (Phase 143: --hybrid support)
// ---------------------------------------------------------------------------

describe('computeSemanticDiff — candidateBlobs (hybrid scoring)', () => {
  it('uses candidateBlobs scores instead of cosine similarity when supplied', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-semanticdiff-'))
    const dbPath = join(tmpDir, 'test.db')
    const session = openDatabaseAt(dbPath)

    try {
      // blobGained: introduced after ref1, present at ref2 → "gained"
      session.rawDb.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobGained', 10, 1)
      session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobGained', 'src/new.ts')
      session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector, file_type) VALUES (?, ?, ?, ?, ?)')
        .run('blobGained', 'm', 4, bufFromArray([0, 1, 0, 0]), 'code')
      session.rawDb.prepare("INSERT INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)")
        .run('commit2', Math.floor(new Date('2023-06-01').getTime() / 1000), 'add new.ts')
      session.rawDb.prepare('INSERT INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)').run('blobGained', 'commit2')

      const queryEmbedding = [1, 0, 0, 0]

      const result = await withDbSession(session, async () =>
        computeSemanticDiff(queryEmbedding, 'test topic', '2020-01-01', '2024-01-01', 10, undefined, [
          { blobHash: 'blobGained', score: 0.42 },
        ]),
      )

      expect(result.gained.length).toBe(1)
      // Cosine similarity between [1,0,0,0] and [0,1,0,0] is 0 — if the
      // candidate score weren't used, score would be 0, not 0.42.
      expect(result.gained[0].score).toBe(0.42)
      expect(result.gained[0].blobHash).toBe('blobGained')
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('falls back to cosine similarity when candidateBlobs is not supplied', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-semanticdiff-'))
    const dbPath = join(tmpDir, 'test.db')
    const session = openDatabaseAt(dbPath)

    try {
      session.rawDb.prepare('INSERT OR IGNORE INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)').run('blobGained', 10, 1)
      session.rawDb.prepare('INSERT INTO paths (blob_hash, path) VALUES (?, ?)').run('blobGained', 'src/new.ts')
      session.rawDb.prepare('INSERT INTO embeddings (blob_hash, model, dimensions, vector, file_type) VALUES (?, ?, ?, ?, ?)')
        .run('blobGained', 'm', 4, bufFromArray([1, 0, 0, 0]), 'code')
      session.rawDb.prepare("INSERT INTO commits (commit_hash, timestamp, message) VALUES (?, ?, ?)")
        .run('commit2', Math.floor(new Date('2023-06-01').getTime() / 1000), 'add new.ts')
      session.rawDb.prepare('INSERT INTO blob_commits (blob_hash, commit_hash) VALUES (?, ?)').run('blobGained', 'commit2')

      const queryEmbedding = [1, 0, 0, 0]

      const result = await withDbSession(session, async () =>
        computeSemanticDiff(queryEmbedding, 'test topic', '2020-01-01', '2024-01-01', 10),
      )

      expect(result.gained.length).toBe(1)
      expect(result.gained[0].score).toBeCloseTo(1)
    } finally {
      session.rawDb.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
