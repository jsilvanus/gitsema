import { getActiveSession } from '../../db/sqlite.js'
import { execFileSync } from 'node:child_process'
import { blobCommits, commits } from '../../db/schema.js'
import { inArray, eq } from 'drizzle-orm'

export interface FirstSeenInfo {
  commitHash: string
  timestamp: number
}

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

    for (const row of rows) {
      const existing = result.get(row.blobHash)
      if (!existing || row.timestamp < existing.timestamp) {
        result.set(row.blobHash, { commitHash: row.commitHash, timestamp: row.timestamp })
      }
    }
  }

  return result
}

export function getLastSeenMap(blobHashes: string[]): Map<string, FirstSeenInfo> {
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

    for (const row of rows) {
      const existing = result.get(row.blobHash)
      if (!existing || row.timestamp > existing.timestamp) {
        result.set(row.blobHash, { commitHash: row.commitHash, timestamp: row.timestamp })
      }
    }
  }

  return result
}

export function filterByTimeRange(
  blobHashes: string[],
  before?: number,
  after?: number,
): string[] {
  if (before === undefined && after === undefined) return blobHashes

  const firstSeenMap = getFirstSeenMap(blobHashes)

  return blobHashes.filter((hash) => {
    const info = firstSeenMap.get(hash)
    if (!info) return false
    if (before !== undefined && info.timestamp >= before) return false
    if (after !== undefined && info.timestamp <= after) return false
    return true
  })
}

/**
 * Filter by the blob's last-seen timestamp (most recent commit it appeared in).
 * This is useful for snapshot-aware semantics where a blob reintroduced later
 * should be considered "recent" despite an older first-seen timestamp.
 */
export function filterByTimeRangeLastSeen(
  blobHashes: string[],
  before?: number,
  after?: number,
): string[] {
  if (before === undefined && after === undefined) return blobHashes

  const lastSeenMap = getLastSeenMap(blobHashes)

  return blobHashes.filter((hash) => {
    const info = lastSeenMap.get(hash)
    if (!info) return false
    if (before !== undefined && info.timestamp >= before) return false
    if (after !== undefined && info.timestamp <= after) return false
    return true
  })
}

export function computeRecencyScores(firstSeenMap: Map<string, FirstSeenInfo>): Map<string, number> {
  const scores = new Map<string, number>()
  if (firstSeenMap.size === 0) return scores

  let minTs = Infinity
  let maxTs = -Infinity
  for (const { timestamp } of firstSeenMap.values()) {
    if (timestamp < minTs) minTs = timestamp
    if (timestamp > maxTs) maxTs = timestamp
  }
  const range = maxTs - minTs

  for (const [blobHash, info] of firstSeenMap) {
    scores.set(blobHash, range === 0 ? 1.0 : (info.timestamp - minTs) / range)
  }

  return scores
}

export function parseDateArg(value: string): number {
  // Try ISO/DATE parsing first
  const d = new Date(value)
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000)

  // Next, try to resolve as a commit hash present in the indexed commits table
  try {
    const { db } = getActiveSession()
    const row = db
      .select({ timestamp: commits.timestamp })
      .from(commits)
      .where(eq(commits.commitHash, value))
      .get()
    if (row && row.timestamp) return row.timestamp
  } catch {
    // fall through to git lookup
  }

  // Finally, treat value as a git ref/commit-ish and query git for the commit timestamp.
  try {
    const commitHash = execFileSync('git', ['rev-parse', '--verify', value], { encoding: 'utf8' }).trim()
    if (commitHash) {
      const tsOut = execFileSync('git', ['show', '-s', '--format=%ct', commitHash], { encoding: 'utf8' }).trim()
      const ts = parseInt(tsOut, 10)
      if (!isNaN(ts)) return ts
    }
  } catch {
    // ignore and throw below
  }

  throw new Error(`Invalid date or ref: "${value}". Expected YYYY-MM-DD, ISO 8601, or a git ref/commit.`)
}
