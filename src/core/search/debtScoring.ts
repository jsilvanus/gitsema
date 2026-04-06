import { getActiveSession } from '../db/sqlite.js'
import type { EmbeddingProvider } from '../embedding/provider.js'

export interface DebtResult {
  blobHash: string
  paths: string[]
  debtScore: number
  isolationScore: number
  ageScore: number
  changeFrequency: number
}

export function scoreDebt(
  dbSession: ReturnType<typeof getActiveSession>,
  _provider: EmbeddingProvider,
  opts: { top?: number; model?: string; branch?: string } = {},
): DebtResult[] {
  const top = opts.top ?? 20
  const { rawDb } = dbSession

  // Pre-compute first-commit timestamp and change frequency for all blobs in one pass.
  // Using a JOIN avoids a per-blob nested subquery.
  const blobStats = rawDb.prepare(`
    SELECT
      b.blob_hash,
      MIN(c.timestamp) AS first_ts,
      COUNT(bc.commit_hash) AS change_freq
    FROM blobs b
    LEFT JOIN blob_commits bc ON bc.blob_hash = b.blob_hash
    LEFT JOIN commits c ON c.commit_hash = bc.commit_hash
    GROUP BY b.blob_hash
  `).all() as Array<{ blob_hash: string; first_ts: number | null; change_freq: number }>

  if (blobStats.length === 0) return []

  // Pre-compute all paths in one query and build a lookup map.
  const allPaths = rawDb.prepare('SELECT blob_hash, path FROM paths').all() as Array<{ blob_hash: string; path: string }>
  const pathMap = new Map<string, string[]>()
  for (const { blob_hash, path } of allPaths) {
    const arr = pathMap.get(blob_hash) ?? []
    arr.push(path)
    pathMap.set(blob_hash, arr)
  }

  const now = Math.floor(Date.now() / 1000)
  const results: DebtResult[] = []

  for (const row of blobStats) {
    const firstTs = row.first_ts ?? now
    const age = now - firstTs
    const ageScore = Math.min(1, age / (60 * 60 * 24 * 365))
    const changeFreq = row.change_freq || 0

    /**
     * Isolation score: ideally (1 - average cosine similarity to k-nearest neighbours).
     * Computing this correctly requires a full embedding scan which is expensive at scale.
     * For now we use a conservative placeholder of 0.5 (middle of the scale); a future
     * iteration can compute this via the usearch HNSW index or a sampled cosine scan.
     */
    const isolation = 0.5

    const debtScore = 0.5 * (1 - isolation) + 0.3 * ageScore + 0.2 * (1 - Math.min(1, changeFreq / 10))
    results.push({
      blobHash: row.blob_hash,
      paths: pathMap.get(row.blob_hash) ?? [],
      debtScore,
      isolationScore: isolation,
      ageScore,
      changeFrequency: changeFreq,
    })
  }
  return results.sort((a, b) => b.debtScore - a.debtScore).slice(0, top)
}
