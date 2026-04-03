import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths, commits, blobCommits } from '../db/schema.js'
import { inArray, eq } from 'drizzle-orm'
import { cosineSimilarity } from './vectorSearch.js'
import type { Embedding } from '../models/types.js'

/**
 * A single blob's contribution to an author's score.
 */
export interface BlobContribution {
  blobHash: string
  paths: string[]
  score: number
  commitHash: string
  timestamp: number
  message: string
}

/**
 * Aggregated contribution of a single author to a semantic concept.
 */
export interface AuthorContribution {
  authorName: string
  authorEmail: string
  /** Sum of relevance scores for all blobs attributed to this author. */
  totalScore: number
  /** Number of unique blobs attributed to this author. */
  blobCount: number
  /** Details of individual blob contributions (populated when --detail is requested). */
  blobs: BlobContribution[]
}

export interface AuthorSearchOptions {
  /** Number of top-K blobs to use when attributing concept authorship. Default 50. */
  topK?: number
  /** Number of top authors to return. Default 10. */
  topAuthors?: number
  /** Only consider blobs whose earliest commit is after this Unix timestamp (seconds). */
  since?: number
  /** Include per-blob contribution detail in results. Default false. */
  detail?: boolean
}

/** Deserializes a Float32Array stored as a Buffer back to number[]. */
function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

/**
 * Computes author contributions for a semantic concept.
 */
export async function computeAuthorContributions(
  queryEmbedding: Embedding,
  options: AuthorSearchOptions = {},
): Promise<AuthorContribution[]> {
  const { topK = 50, topAuthors = 10, since, detail = false } = options
  const { db } = getActiveSession()

  // 1. Load all blob embeddings
  const allEmbRows = db
    .select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
    .from(embeddings)
    .all()

  if (allEmbRows.length === 0) return []

  // 2. Score each blob against the query embedding
  type ScoredBlob = { blobHash: string; score: number }
  const scored: ScoredBlob[] = allEmbRows.map((row) => ({
    blobHash: row.blobHash,
    score: cosineSimilarity(queryEmbedding, bufferToEmbedding(row.vector as Buffer)),
  }))

  // Sort descending and take top-K
  scored.sort((a, b) => b.score - a.score)
  const topBlobs = scored.slice(0, topK)
  if (topBlobs.length === 0) return []

  const topBlobHashes = topBlobs.map((b) => b.blobHash)
  const blobScoreMap = new Map<string, number>(topBlobs.map((b) => [b.blobHash, b.score]))

  // 3. Look up earliest commit per blob (the "author" of that blob)
  //    Join blob_commits → commits to get author info.
  const BATCH = 500
  type CommitInfo = {
    commitHash: string
    timestamp: number
    message: string
    authorName: string | null
    authorEmail: string | null
  }
  const earliestCommitMap = new Map<string, CommitInfo>()

  for (let i = 0; i < topBlobHashes.length; i += BATCH) {
    const batch = topBlobHashes.slice(i, i + BATCH)
    const rows = db
      .select({
        blobHash: blobCommits.blobHash,
        commitHash: commits.commitHash,
        timestamp: commits.timestamp,
        message: commits.message,
        authorName: commits.authorName,
        authorEmail: commits.authorEmail,
      })
      .from(blobCommits)
      .innerJoin(commits, eq(blobCommits.commitHash, commits.commitHash))
      .where(inArray(blobCommits.blobHash, batch))
      .all()

    for (const row of rows) {
      // Apply `since` filter
      if (since !== undefined && row.timestamp < since) continue

      const existing = earliestCommitMap.get(row.blobHash)
      if (!existing || row.timestamp < existing.timestamp) {
        earliestCommitMap.set(row.blobHash, {
          commitHash: row.commitHash,
          timestamp: row.timestamp,
          message: row.message,
          authorName: row.authorName,
          authorEmail: row.authorEmail,
        })
      }
    }
  }

  // 4. Resolve file paths for the top blobs
  const pathRows = db
    .select({ blobHash: paths.blobHash, path: paths.path })
    .from(paths)
    .where(inArray(paths.blobHash, topBlobHashes))
    .all()

  const pathsByBlob = new Map<string, string[]>()
  for (const row of pathRows) {
    const list = pathsByBlob.get(row.blobHash) ?? []
    list.push(row.path)
    pathsByBlob.set(row.blobHash, list)
  }

  // 5. Aggregate scores by author
  const authorMap = new Map<string, AuthorContribution>()

  for (const blobHash of topBlobHashes) {
    const commitInfo = earliestCommitMap.get(blobHash)
    if (!commitInfo) continue // blob has no commit (shouldn't happen) or filtered by since

    const score = blobScoreMap.get(blobHash) ?? 0
    const authorName = commitInfo.authorName ?? 'Unknown'
    const authorEmail = commitInfo.authorEmail ?? ''
    const key = `${authorName}\x00${authorEmail}`

    let entry = authorMap.get(key)
    if (!entry) {
      entry = { authorName, authorEmail, totalScore: 0, blobCount: 0, blobs: [] }
      authorMap.set(key, entry)
    }

    entry.totalScore += score
    entry.blobCount++

    if (detail) {
      entry.blobs.push({
        blobHash,
        paths: pathsByBlob.get(blobHash) ?? [],
        score,
        commitHash: commitInfo.commitHash,
        timestamp: commitInfo.timestamp,
        message: commitInfo.message,
      })
    }
  }

  // 6. Sort authors by total score descending, take top-N
  const sorted = Array.from(authorMap.values()).sort((a, b) => b.totalScore - a.totalScore)
  return sorted.slice(0, topAuthors)
}
