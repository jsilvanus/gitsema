/**
 * `gitsema storage migrate` (Phase 103).
 *
 * Copies an index from one `StorageProfile` to another by reading rows/vectors
 * from the source and writing them via the destination's `MetadataStore`/
 * `VectorStore`/`FtsStore`/`writeBlobRecord` methods. All writes are
 * content-addressed (`ON CONFLICT DO NOTHING` / deterministic point ids), so
 * a migration can be safely re-run to resume after an interruption — see
 * docs/storage-backends-plan.md §8.
 *
 * Only `sqlite` sources are supported for now (documented deviation): the
 * sqlite adapter is the only one with cheap full-table enumeration via direct
 * `better-sqlite3` access. Migrating *from* postgres/qdrant would need new
 * "list all" methods on `MetadataStore`/`VectorStore`, which is a larger,
 * separately-scoped change.
 */

import { getOrOpenSessionAtPath } from '../db/sqlite.js'
import { bufferToFloat32 } from '../../utils/embedding.js'
import { dequantizeVector, deserializeQuantized } from '../embedding/quantize.js'
import type { Embedding } from '../models/types.js'
import type { CommitEntry } from '../git/commitMap.js'
import type { StorageProfile } from './types.js'

export interface MigrateStats {
  blobs: number
  paths: number
  fileEmbeddings: number
  ftsEntries: number
  commits: number
  blobCommits: number
  blobBranches: number
  indexedCommits: number
  chunkEmbeddings: number
  symbolEmbeddings: number
  moduleEmbeddings: number
  commitEmbeddings: number
}

interface VectorRow {
  vector: Buffer
  quantized?: number | null
  quant_min?: number | null
  quant_scale?: number | null
}

function rowToEmbedding(row: VectorRow): Embedding {
  if (row.quantized === 1 && row.quant_min != null && row.quant_scale != null) {
    return dequantizeVector(deserializeQuantized(row.vector, row.quant_min, row.quant_scale))
  }
  return bufferToFloat32(row.vector)
}

/**
 * Migrates `source` (must be `sqlite`) into `dest`. Returns counts of rows
 * processed per category. Safe to re-run — every write uses the destination's
 * idempotent insert paths.
 */
export async function migrateStorage(source: StorageProfile, dest: StorageProfile): Promise<MigrateStats> {
  if (source.backend !== 'sqlite') {
    throw new Error(
      `gitsema storage migrate: source backend '${source.backend}' is not yet supported ` +
        `(only sqlite sources can be migrated today — see docs/storage-backends-plan.md §8)`,
    )
  }

  const { rawDb } = getOrOpenSessionAtPath(source.location)
  const stats: MigrateStats = {
    blobs: 0, paths: 0, fileEmbeddings: 0, ftsEntries: 0, commits: 0,
    blobCommits: 0, blobBranches: 0, indexedCommits: 0,
    chunkEmbeddings: 0, symbolEmbeddings: 0, moduleEmbeddings: 0, commitEmbeddings: 0,
  }

  // blobs
  for (const row of rawDb.prepare('SELECT blob_hash, size FROM blobs').iterate() as Iterable<{ blob_hash: string; size: number }>) {
    await dest.metadata.putBlob(row.blob_hash, row.size)
    stats.blobs++
  }

  // paths
  for (const row of rawDb.prepare('SELECT blob_hash, path FROM paths').iterate() as Iterable<{ blob_hash: string; path: string }>) {
    await dest.metadata.addPath(row.blob_hash, row.path)
    stats.paths++
  }

  // whole-file embeddings
  for (const row of rawDb.prepare(
    'SELECT blob_hash, model, dimensions, vector, quantized, quant_min, quant_scale FROM embeddings',
  ).iterate() as Iterable<{ blob_hash: string; model: string; dimensions: number } & VectorRow>) {
    await dest.vectors.upsert('file', [{ id: row.blob_hash, model: row.model, dimensions: row.dimensions, embedding: rowToEmbedding(row) }])
    stats.fileEmbeddings++
  }

  // FTS content
  if (dest.fts) {
    for (const row of rawDb.prepare('SELECT blob_hash, content FROM blob_fts').iterate() as Iterable<{ blob_hash: string; content: string }>) {
      await dest.fts.index(row.blob_hash, row.content)
      stats.ftsEntries++
    }
  }

  // commits
  for (const row of rawDb.prepare(
    'SELECT commit_hash, "timestamp", message, author_name, author_email FROM commits',
  ).iterate() as Iterable<{ commit_hash: string; timestamp: number; message: string; author_name: string | null; author_email: string | null }>) {
    const commit: CommitEntry = {
      commitHash: row.commit_hash, timestamp: row.timestamp, message: row.message,
      authorName: row.author_name ?? undefined, authorEmail: row.author_email ?? undefined, branches: [],
    }
    await dest.metadata.putCommit(commit)
    stats.commits++
  }

  // blob_commits (grouped by commit so linkBlobCommits can dedupe/skip un-migrated blobs)
  const blobsByCommit = new Map<string, string[]>()
  for (const row of rawDb.prepare('SELECT commit_hash, blob_hash FROM blob_commits').iterate() as Iterable<{ commit_hash: string; blob_hash: string }>) {
    const list = blobsByCommit.get(row.commit_hash) ?? []
    list.push(row.blob_hash)
    blobsByCommit.set(row.commit_hash, list)
  }
  for (const [commitHash, blobHashes] of blobsByCommit) {
    stats.blobCommits += await dest.metadata.linkBlobCommits(commitHash, blobHashes)
  }

  // blob_branches (grouped by blob)
  const branchesByBlob = new Map<string, string[]>()
  for (const row of rawDb.prepare('SELECT blob_hash, branch_name FROM blob_branches').iterate() as Iterable<{ blob_hash: string; branch_name: string }>) {
    const list = branchesByBlob.get(row.blob_hash) ?? []
    list.push(row.branch_name)
    branchesByBlob.set(row.blob_hash, list)
  }
  for (const [blobHash, branches] of branchesByBlob) {
    await dest.metadata.setBlobBranches(blobHash, branches)
    stats.blobBranches += branches.length
  }

  // indexed_commits (oldest first, so getLastIndexedCommit ends up pointing at the newest)
  for (const row of rawDb.prepare('SELECT commit_hash FROM indexed_commits ORDER BY indexed_at ASC').iterate() as Iterable<{ commit_hash: string }>) {
    await dest.metadata.markCommitIndexed(row.commit_hash)
    stats.indexedCommits++
  }

  // chunk embeddings
  for (const row of rawDb.prepare(
    `SELECT c.blob_hash, c.start_line, c.end_line, ce.model, ce.dimensions, ce.vector, ce.quantized, ce.quant_min, ce.quant_scale
     FROM chunks c JOIN chunk_embeddings ce ON ce.chunk_id = c.id`,
  ).iterate() as Iterable<{ blob_hash: string; start_line: number; end_line: number; model: string; dimensions: number } & VectorRow>) {
    await dest.vectors.upsert('chunk', [{
      id: row.blob_hash, model: row.model, dimensions: row.dimensions, embedding: rowToEmbedding(row),
      startLine: row.start_line, endLine: row.end_line,
    }])
    stats.chunkEmbeddings++
  }

  // symbol embeddings
  for (const row of rawDb.prepare(
    `SELECT s.blob_hash, s.start_line, s.end_line, s.symbol_name, s.symbol_kind, s.language,
            se.model, se.dimensions, se.vector, se.quantized, se.quant_min, se.quant_scale
     FROM symbols s JOIN symbol_embeddings se ON se.symbol_id = s.id`,
  ).iterate() as Iterable<{
    blob_hash: string; start_line: number; end_line: number; symbol_name: string; symbol_kind: string; language: string
    model: string; dimensions: number
  } & VectorRow>) {
    await dest.vectors.upsert('symbol', [{
      id: row.blob_hash, model: row.model, dimensions: row.dimensions, embedding: rowToEmbedding(row),
      startLine: row.start_line, endLine: row.end_line,
      symbolName: row.symbol_name, symbolKind: row.symbol_kind, language: row.language,
    }])
    stats.symbolEmbeddings++
  }

  // module (directory centroid) embeddings
  for (const row of rawDb.prepare(
    'SELECT module_path, model, dimensions, vector, blob_count FROM module_embeddings',
  ).iterate() as Iterable<{ module_path: string; model: string; dimensions: number; vector: Buffer; blob_count: number }>) {
    await dest.vectors.upsert('module', [{
      id: row.module_path, model: row.model, dimensions: row.dimensions, embedding: bufferToFloat32(row.vector), blobCount: row.blob_count,
    }])
    stats.moduleEmbeddings++
  }

  // commit message embeddings
  for (const row of rawDb.prepare(
    'SELECT commit_hash, model, dimensions, vector, quantized, quant_min, quant_scale FROM commit_embeddings',
  ).iterate() as Iterable<{ commit_hash: string; model: string; dimensions: number } & VectorRow>) {
    await dest.vectors.upsert('commit', [{ id: row.commit_hash, model: row.model, dimensions: row.dimensions, embedding: rowToEmbedding(row) }])
    stats.commitEmbeddings++
  }

  return stats
}
