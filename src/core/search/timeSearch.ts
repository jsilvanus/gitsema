import { getActiveSession } from '../db/sqlite.js'
import { blobCommits, commits } from '../db/schema.js'
import { inArray, eq } from 'drizzle-orm'

export interface FirstSeenInfo {
  commitHash: string
  timestamp: number   // Unix epoch (seconds)
}

/**
 * For a list of blob hashes, returns the earliest commit each blob appears in.
 * Blobs not present in blobCommits are omitted from the result.
 */
export function getFirstSeenMap(blobHashes: string[]): Map<string, FirstSeenInfo> {
  if (blobHashes.length === 0) return new Map()

  const BATCH = 500
  const result = new Map<string, FirstSeenInfo>()
  const { db } = getActiveSession()

  for (let i = 0; i < blobHashes.length; i += BATCH) {
    const batch = blobHashes.slice(i, i + BATCH)
    const rows = db
      .select({
        blobHash: blobCommits.blobHash,
        commitHash: commits.commitHash,
        timestamp: commits.timestamp,
      })
      .from(blobCommits)
      .innerJoin(commits, eq(blobCommits.commitHash, commits.commitHash))
      .where(inArray(blobCommits.blobHash, batch))
      .all()

    // Keep the minimum timestamp per blob
    for (const row of rows) {
      const existing = result.get(row.blobHash)
      if (!existing || row.timestamp < existing.timestamp) {
        result.set(row.blobHash, { commitHash: row.commitHash, timestamp: row.timestamp })
      }
    }
  }

  return result
}

/**
 * Filters blob hashes to those whose earliest commit falls within the given time range.
 * `before` and `after` are Unix timestamps (seconds).
 * Only blobs that have commit history are kept when a filter is active.
 */
export function filterByTimeRange(
  blobHashes: string[],
  before?: number,
  after?: number,
): string[] {
  if (before === undefined && after === undefined) return blobHashes

  const firstSeenMap = getFirstSeenMap(blobHashes)

  return blobHashes.filter((hash) => {
    const info = firstSeenMap.get(hash)
    if (!info) return false   // no commit history — exclude when filtering
    if (before !== undefined && info.timestamp >= before) return false
    if (after !== undefined && info.timestamp <= after) return false
    return true
  })
}

/**
 * Normalizes an array of timestamps to recency scores in [0, 1].
 * The most recent timestamp gets score 1.0; the oldest gets 0.0.
 * Returns a Map from blobHash -> recencyScore.
 */
export function computeRecencyScores(firstSeenMap: Map<string, FirstSeenInfo>): Map<string, number> {
  const scores = new Map<string, number>()
  if (firstSeenMap.size === 0) return scores

  const timestamps = Array.from(firstSeenMap.values()).map((v) => v.timestamp)
  const minTs = Math.min(...timestamps)
  const maxTs = Math.max(...timestamps)
  const range = maxTs - minTs

  for (const [blobHash, info] of firstSeenMap) {
    scores.set(blobHash, range === 0 ? 1.0 : (info.timestamp - minTs) / range)
  }

  return scores
}

/**
 * Parses a date string (YYYY-MM-DD or ISO 8601) into a Unix timestamp (seconds).
 * Throws on invalid input.
 */
export function parseDateArg(value: string): number {
  const d = new Date(value)
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date: "${value}". Expected YYYY-MM-DD or ISO 8601 format.`)
  }
  return Math.floor(d.getTime() / 1000)
}
