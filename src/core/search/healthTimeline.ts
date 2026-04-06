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
  const rows = rawDb.prepare('SELECT commit_hash, timestamp FROM commits ORDER BY timestamp ASC').all() as Array<{ commit_hash: string; timestamp: number }>
  if (rows.length === 0) return []
  const min = rows[0].timestamp
  const max = rows[rows.length - 1].timestamp
  const span = Math.max(1, max - min)
  const bucketSize = Math.ceil(span / buckets)

  // Compute HEAD blobs once — reused across all bucket iterations
  const headBlobs = rawDb.prepare('SELECT blob_hash FROM blob_commits WHERE commit_hash = (SELECT commit_hash FROM commits ORDER BY timestamp DESC LIMIT 1)').all() as Array<{ blob_hash: string }>
  const headSet = new Set(headBlobs.map((r) => r.blob_hash))

  const snapshots: HealthSnapshot[] = []
  for (let i = 0; i < buckets; i++) {
    const start = min + i * bucketSize
    const end = start + bucketSize
    // activeBlobCount: count of unique blobs in this period
    const active = rawDb.prepare('SELECT COUNT(DISTINCT blob_hash) as c FROM blob_commits WHERE commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?)').get(start, end) as { c: number }
    // new blobs in period: blobs whose first commit is in this period
    const newCount = rawDb.prepare('SELECT COUNT(DISTINCT blob_hash) as c FROM blob_commits bc WHERE bc.commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?) AND bc.blob_hash NOT IN (SELECT blob_hash FROM blob_commits bc2 WHERE bc2.commit_hash < ?)').get(start, end, start) as { c: number }
    const total = active.c || 0
    const churn = total === 0 ? 0 : (newCount.c / total)
    // deadConceptRatio: blobs from this period no longer in HEAD
    const periodBlobs = rawDb.prepare('SELECT DISTINCT blob_hash FROM blob_commits WHERE commit_hash IN (SELECT commit_hash FROM commits WHERE timestamp >= ? AND timestamp < ?)').all(start, end) as Array<{ blob_hash: string }>
    const dead = periodBlobs.filter((b) => !headSet.has(b.blob_hash)).length
    const deadRatio = periodBlobs.length === 0 ? 0 : dead / periodBlobs.length
    snapshots.push({ periodStart: start, periodEnd: end, activeBlobCount: total, semanticChurnRate: churn, deadConceptRatio: deadRatio })
  }
  return snapshots
}
