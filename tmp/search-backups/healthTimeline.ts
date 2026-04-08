import { getActiveSession } from '../db/sqlite.js'

export interface HealthSnapshot {
  periodStart: number
  periodEnd: number
  activeBlobCount: number
  semanticChurnRate: number
  deadConceptRatio: number
}

export function computeHealthTimeline(dbSession: ReturnType<typeof getActiveSession>, opts: { buckets?: number; branch?: string } = {}): HealthSnapshot[] {
  const buckets = opts.buckets ?? 12
  const { rawDb } = dbSession
  const branch = opts.branch ?? null

  // Fetch the ordered commit list.
  // When a branch filter is set, restrict to commits that touched at least one
  // blob on the target branch (via blob_branches join).
  let rows: Array<{ commit_hash: string; timestamp: number }>
  if (branch !== null) {
    rows = rawDb.prepare(
      `SELECT DISTINCT c.commit_hash, c.timestamp FROM commits c
       JOIN blob_commits bc ON bc.commit_hash = c.commit_hash
       JOIN blob_branches bb ON bb.blob_hash = bc.blob_hash
       WHERE bb.branch_name = ?
       ORDER BY c.timestamp ASC`,
    ).all(branch) as Array<{ commit_hash: string; timestamp: number }>
  } else {
    rows = rawDb.prepare('SELECT commit_hash, timestamp FROM commits ORDER BY timestamp ASC').all() as Array<{ commit_hash: string; timestamp: number }>
  }

  if (rows.length === 0) return []
  const min = rows[0].timestamp
  const max = rows[rows.length - 1].timestamp
  const span = Math.max(1, max - min)
  const bucketSize = Math.ceil(span / buckets)

  // Compute "HEAD" blobs once — the most recent commit on the branch (or overall).
  let headBlobs: Array<{ blob_hash: string }>
  if (branch !== null) {
    headBlobs = rawDb.prepare(
      `SELECT DISTINCT bc.blob_hash FROM blob_commits bc
       JOIN commits c ON c.commit_hash = bc.commit_hash
       JOIN blob_branches bb ON bb.blob_hash = bc.blob_hash
       WHERE bb.branch_name = ?
       ORDER BY c.timestamp DESC LIMIT 1`,
    ).all(branch) as Array<{ blob_hash: string }>
  } else {
    headBlobs = rawDb.prepare(
      `SELECT blob_hash FROM blob_commits WHERE commit_hash = (SELECT commit_hash FROM commits ORDER BY timestamp DESC LIMIT 1)`,
    ).all() as Array<{ blob_hash: string }>
  }
  const headSet = new Set(headBlobs.map((r) => r.blob_hash))

  // Prepare bucket-level statements once outside the loop.
  // Two variants: with and without branch filter.
  const stmtActive = branch !== null
    ? rawDb.prepare(
        `SELECT COUNT(DISTINCT bc.blob_hash) as c
         FROM blob_commits bc
         JOIN blob_branches bb ON bb.blob_hash = bc.blob_hash
         WHERE bb.branch_name = ?
           AND bc.commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?)`,
      )
    : rawDb.prepare(
        `SELECT COUNT(DISTINCT blob_hash) as c FROM blob_commits WHERE commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?)`,
      )

  const stmtNew = branch !== null
    ? rawDb.prepare(
        `SELECT COUNT(DISTINCT bc.blob_hash) as c
         FROM blob_commits bc
         JOIN blob_branches bb ON bb.blob_hash = bc.blob_hash
         WHERE bb.branch_name = ?
           AND bc.commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?)
           AND bc.blob_hash NOT IN (
             SELECT bc2.blob_hash FROM blob_commits bc2
             JOIN blob_branches bb2 ON bb2.blob_hash = bc2.blob_hash
             WHERE bb2.branch_name = ?
               AND bc2.commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp < ?)
           )`,
      )
    : rawDb.prepare(
        `SELECT COUNT(DISTINCT blob_hash) as c FROM blob_commits bc WHERE bc.commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?) AND bc.blob_hash NOT IN (SELECT blob_hash FROM blob_commits bc2 WHERE bc2.commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp < ?))`,
      )

  const stmtPeriodBlobs = branch !== null
    ? rawDb.prepare(
        `SELECT DISTINCT bc.blob_hash FROM blob_commits bc
         JOIN blob_branches bb ON bb.blob_hash = bc.blob_hash
         WHERE bb.branch_name = ?
           AND bc.commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?)`,
      )
    : rawDb.prepare(
        `SELECT DISTINCT blob_hash FROM blob_commits WHERE commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?)`,
      )

  const snapshots: HealthSnapshot[] = []
  for (let i = 0; i < buckets; i++) {
    const start = min + i * bucketSize
    const end = start + bucketSize

    const active = (branch !== null
      ? stmtActive.get(branch, start, end)
      : stmtActive.get(start, end)) as { c: number }

    const newCount = (branch !== null
      ? stmtNew.get(branch, start, end, branch, start)
      : stmtNew.get(start, end, start)) as { c: number }

    const total = active.c || 0
    const churn = total === 0 ? 0 : (newCount.c / total)

    const periodBlobs = (branch !== null
      ? stmtPeriodBlobs.all(branch, start, end)
      : stmtPeriodBlobs.all(start, end)) as Array<{ blob_hash: string }>

    const dead = periodBlobs.filter((b) => !headSet.has(b.blob_hash)).length
    const deadRatio = periodBlobs.length === 0 ? 0 : dead / periodBlobs.length
    snapshots.push({ periodStart: start, periodEnd: end, activeBlobCount: total, semanticChurnRate: churn, deadConceptRatio: deadRatio })
  }
  return snapshots
}
