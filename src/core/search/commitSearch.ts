import { getActiveSession } from '../db/sqlite.js'
import { commitEmbeddings, commits, blobCommits, paths, blobs } from '../db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import type { Embedding } from '../models/types.js'
import { cosineSimilarity } from './vectorSearch.js'

/**
 * A single result from `searchCommits()`.
 *
 * Contains the commit metadata (hash, message, timestamp), the similarity
 * score against the query, and the file paths touched by that commit.
 */
export interface CommitSearchResult {
  commitHash: string
  score: number
  message: string
  timestamp: number
  /** Paths of blobs introduced or modified by this commit that are in the index. */
  paths: string[]
}

export interface CommitSearchOptions {
  /** Maximum number of results to return (default 10). */
  topK?: number
  /** When set, only embeddings produced by this model are considered. */
  model?: string
}

/**
 * Searches the `commit_embeddings` table by cosine similarity against
 * the provided query embedding.  Returns the top-k commits ranked by
 * how semantically similar their message is to the query.
 *
 * Only commits that have been embedded (i.e. rows in `commit_embeddings`)
 * are considered.  Commits indexed before Phase 30 will not appear.
 *
 * @param queryEmbedding - pre-computed embedding of the search query
 * @param options        - optional filters / topK
 */
export function searchCommits(
  queryEmbedding: Embedding,
  options: CommitSearchOptions = {},
): CommitSearchResult[] {
  const { topK = 10, model } = options
  const { db, rawDb } = getActiveSession()

  // Load commit embeddings, optionally filtered to a specific model
  const baseQuery = db.select({
    commitHash: commitEmbeddings.commitHash,
    vector: commitEmbeddings.vector,
  }).from(commitEmbeddings)

  const rows = model
    ? baseQuery.where(eq(commitEmbeddings.model, model)).all()
    : baseQuery.all()

  if (rows.length === 0) return []

  // Score by cosine similarity
  type ScoredRow = { commitHash: string; score: number }
  const scored: ScoredRow[] = rows.map((row) => {
    const buf = row.vector as Buffer
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
    const vec = Array.from(f32)
    return { commitHash: row.commitHash, score: cosineSimilarity(queryEmbedding, vec) }
  })

  scored.sort((a, b) => b.score - a.score)
  const topHashes = scored.slice(0, topK).map((s) => s.commitHash)
  if (topHashes.length === 0) return []

  // Fetch commit metadata (message, timestamp)
  const commitRows = db.select({
    commitHash: commits.commitHash,
    message: commits.message,
    timestamp: commits.timestamp,
  })
    .from(commits)
    .where(inArray(commits.commitHash, topHashes))
    .all()

  const commitMeta = new Map(commitRows.map((c) => [c.commitHash, c]))

  // Fetch blob-commit links and resolve file paths for the top commits
  const blobCommitRows = db.select({
    commitHash: blobCommits.commitHash,
    blobHash: blobCommits.blobHash,
  })
    .from(blobCommits)
    .where(inArray(blobCommits.commitHash, topHashes))
    .all()

  const blobHashesByCommit = new Map<string, string[]>()
  for (const row of blobCommitRows) {
    const list = blobHashesByCommit.get(row.commitHash) ?? []
    list.push(row.blobHash)
    blobHashesByCommit.set(row.commitHash, list)
  }

  // Gather all unique blob hashes so we can batch-resolve paths
  const allBlobHashes = [...new Set(blobCommitRows.map((r) => r.blobHash))]
  let pathsByBlob = new Map<string, string[]>()
  if (allBlobHashes.length > 0) {
    const BATCH = 500
    for (let i = 0; i < allBlobHashes.length; i += BATCH) {
      const batch = allBlobHashes.slice(i, i + BATCH)
      const pathRows = db.select({ blobHash: paths.blobHash, path: paths.path })
        .from(paths)
        .where(inArray(paths.blobHash, batch))
        .all()
      for (const row of pathRows) {
        const list = pathsByBlob.get(row.blobHash) ?? []
        list.push(row.path)
        pathsByBlob.set(row.blobHash, list)
      }
    }
  }

  // Assemble results
  return scored.slice(0, topK).flatMap((s) => {
    const meta = commitMeta.get(s.commitHash)
    if (!meta) return []
    const blobHashes = blobHashesByCommit.get(s.commitHash) ?? []
    const commitPaths = [...new Set(
      blobHashes.flatMap((h) => pathsByBlob.get(h) ?? [])
    )]
    return [{
      commitHash: s.commitHash,
      score: s.score,
      message: meta.message,
      timestamp: meta.timestamp,
      paths: commitPaths,
    }]
  })
}
