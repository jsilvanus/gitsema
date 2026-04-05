import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths, commits, blobCommits } from '../db/schema.js'
import { inArray, eq, sql, and } from 'drizzle-orm'
import { cosineSimilarity, vectorNorm, cosineSimilarityPrecomputed } from './vectorSearch.js'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single dead-concept result.
 *
 * A "dead concept" is a blob that was once present in the Git history but is
 * no longer reachable from HEAD.  Results are ranked by their semantic
 * similarity to the centroid of all current HEAD blobs — high-scoring entries
 * are concepts that once existed and are still semantically relevant to what
 * lives in HEAD today.
 */
export interface DeadConceptResult {
  /** SHA-1 hash of the dead blob. */
  blobHash: string
  /** All file paths this blob was known by during its lifetime. */
  paths: string[]
  /**
   * Cosine similarity to the mean embedding vector of current HEAD blobs.
   * Higher → more semantically related to what still exists in HEAD.
   */
  score: number
  /** Hash of the latest commit that contained this blob, or null if unknown. */
  lastSeenCommit: string | null
  /** Unix epoch (seconds) of the latest such commit, or null if unknown. */
  lastSeenDate: number | null
  /** First line of that commit's message, or null. */
  lastSeenMessage: string | null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deserializes a Float32Array stored as a Buffer back to Float32Array. */
function bufferToEmbedding(buf: Buffer): Float32Array {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return f32
}

/**
 * Returns the set of blob hashes currently reachable from HEAD via
 * `git ls-tree -r HEAD`.  When git is unavailable or HEAD does not exist
 * (e.g. empty repo) the function returns an empty Set.
 */
async function getHeadBlobHashes(repoPath: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-tree', '-r', '--format=%(objectname)', 'HEAD'],
      { cwd: repoPath },
    )
    const hashes = new Set<string>()
    for (const line of stdout.split('\n')) {
      const h = line.trim()
      if (h.length === 40) hashes.add(h)
    }
    return hashes
  } catch {
    return new Set()
  }
}

/**
 * Computes the element-wise mean of an array of equal-length vectors.
 * Returns null when the input is empty.
 */
export function meanVector(vectors: (number[] | Float32Array)[]): Float32Array | null {
  if (vectors.length === 0) return null
  const dim = vectors[0]?.length ?? 0
  if (dim === 0) return null
  const sum = new Float32Array(dim)
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += vec[i]
    }
  }
  const n = vectors.length
  for (let i = 0; i < sum.length; i++) sum[i] /= n
  return sum
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Finds embeddings that are semantically related to current HEAD content but
 * whose blobs are no longer present in the HEAD tree (i.e. they have been
 * deleted or replaced).
 *
 * Algorithm:
 *  1. Fetch all blob hashes currently in HEAD via `git ls-tree`.
 *  2. Load all embeddings from the index; partition into HEAD vs. dead sets.
 *  3. Compute the centroid of HEAD blob embeddings.
 *  4. Score every dead blob by cosine similarity to that centroid.
 *  5. Optionally filter dead blobs to those whose latest commit is on or after
 *     `since` (Unix seconds), so callers can narrow to recently-removed concepts.
 *  6. Return the top-K dead blobs sorted by score descending.
 *
 * @param opts.topK     - Maximum results to return (default 10).
 * @param opts.since    - Unix timestamp (seconds); exclude dead blobs whose latest
 *                        commit pre-dates this value.  When omitted, all dead blobs
 *                        are considered.
 * @param opts.repoPath - Repository working directory (default '.').
 */
export async function findDeadConcepts(opts: {
  topK?: number
  since?: number
  repoPath?: string
  branch?: string
}): Promise<DeadConceptResult[]> {
  const { topK = 10, since, repoPath = '.', branch } = opts
  const { db } = getActiveSession()

  // 1. Blobs reachable from HEAD
  const headHashes = await getHeadBlobHashes(repoPath)

  // 2. All indexed embeddings
  const baseQuery = db.select({ blobHash: embeddings.blobHash, vector: embeddings.vector }).from(embeddings)
  const conditions: any[] = []
  if (branch) conditions.push(sql`${embeddings.blobHash} IN (SELECT blob_hash FROM blob_branches WHERE branch_name = ${branch})`)
  let allEmbRows = (conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery).all()

  if (allEmbRows.length === 0) return []

  // Partition into HEAD-present vs. dead
  const headVectors: Float32Array[] = []
  const deadEmbMap = new Map<string, Float32Array>()

  for (const row of allEmbRows) {
    if (headHashes.has(row.blobHash)) {
      headVectors.push(bufferToEmbedding(row.vector as Buffer))
    } else {
      deadEmbMap.set(row.blobHash, bufferToEmbedding(row.vector as Buffer))
    }
  }

  const deadHashes = Array.from(deadEmbMap.keys())
  if (deadHashes.length === 0) return []

  // 3. Centroid of HEAD blobs
  const centroid = meanVector(headVectors)
  if (!centroid) return []

  // 4. Score dead blobs by similarity to centroid

  type ScoredDead = { blobHash: string; score: number }
  const scored: ScoredDead[] = deadHashes.map((hash) => ({
    blobHash: hash,
    score: cosineSimilarity(centroid, deadEmbMap.get(hash)!),
  }))

  // 5. Resolve last-seen (latest) commit for each dead blob
  const BATCH = 500
  const lastSeenMap = new Map<string, { commitHash: string; timestamp: number; message: string }>()

  for (let i = 0; i < deadHashes.length; i += BATCH) {
    const batch = deadHashes.slice(i, i + BATCH)
    const rows = db
      .select({
        blobHash: blobCommits.blobHash,
        commitHash: commits.commitHash,
        timestamp: commits.timestamp,
        message: commits.message,
      })
      .from(blobCommits)
      .innerJoin(commits, eq(blobCommits.commitHash, commits.commitHash))
      .where(inArray(blobCommits.blobHash, batch))
      .all()

    // Keep the maximum timestamp (latest commit) per blob
    for (const row of rows) {
      const existing = lastSeenMap.get(row.blobHash)
      if (!existing || row.timestamp > existing.timestamp) {
        lastSeenMap.set(row.blobHash, {
          commitHash: row.commitHash,
          timestamp: row.timestamp,
          message: row.message,
        })
      }
    }
  }

  // Apply optional `since` filter: drop dead blobs whose last commit pre-dates `since`
  const filteredScored = since !== undefined
    ? scored.filter((s) => {
        const info = lastSeenMap.get(s.blobHash)
        return info !== undefined && info.timestamp >= since
      })
    : scored

  // Sort descending by score, take top-K
  filteredScored.sort((a, b) => b.score - a.score)
  const top = filteredScored.slice(0, topK)

  if (top.length === 0) return []

  // 6. Resolve file paths for the result set
  const topHashes = top.map((s) => s.blobHash)
  const pathRows = db
    .select({ blobHash: paths.blobHash, path: paths.path })
    .from(paths)
    .where(inArray(paths.blobHash, topHashes))
    .all()

  const pathsByBlob = new Map<string, string[]>()
  for (const row of pathRows) {
    const list = pathsByBlob.get(row.blobHash) ?? []
    list.push(row.path)
    pathsByBlob.set(row.blobHash, list)
  }

  return top.map((s) => {
    const info = lastSeenMap.get(s.blobHash) ?? null
    return {
      blobHash: s.blobHash,
      paths: pathsByBlob.get(s.blobHash) ?? [],
      score: s.score,
      lastSeenCommit: info?.commitHash ?? null,
      lastSeenDate: info?.timestamp ?? null,
      lastSeenMessage: info?.message ?? null,
    }
  })
}
