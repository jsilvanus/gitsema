import { getActiveSession } from '../../db/sqlite.js'
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
  const d = new Date(value)
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date: "${value}". Expected YYYY-MM-DD or ISO 8601 format.`)
  }
  return Math.floor(d.getTime() / 1000)
}
