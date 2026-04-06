import { getActiveSession } from '../db/sqlite.js'

export interface DebtResult {
  blobHash: string
  paths: string[]
  debtScore: number
  isolationScore: number
  ageScore: number
  changeFrequency: number
}

export function scoreDebt(dbSession: ReturnType<typeof getActiveSession>, provider: any, opts: { top?: number; model?: string; branch?: string } = {}): DebtResult[] {
  const top = opts.top ?? 20
  const { rawDb } = dbSession
  const rows = rawDb.prepare('SELECT blob_hash FROM blobs').all() as Array<{ blob_hash: string }>
  if (rows.length === 0) return []
  const now = Math.floor(Date.now() / 1000)
  const results: DebtResult[] = []
  for (const r of rows) {
    const paths = rawDb.prepare('SELECT path FROM paths WHERE blob_hash = ?').all(r.blob_hash).map((x: any) => x.path)
    const first = rawDb.prepare('SELECT timestamp FROM commits WHERE commit_hash = (SELECT commit_hash FROM blob_commits WHERE blob_hash = ? ORDER BY timestamp ASC LIMIT 1)').get(r.blob_hash) as { timestamp?: number } | undefined
    const firstTs = first?.timestamp ?? now
    const age = now - firstTs
    // simplified scores
    const ageScore = Math.min(1, age / (60 * 60 * 24 * 365))
    const changeFreqRow = rawDb.prepare('SELECT COUNT(*) as c FROM blob_commits WHERE blob_hash = ?').get(r.blob_hash) as { c?: number } | undefined
    const changeFreq = (changeFreqRow?.c ?? 0) || 0
    const isolation = 0.5 // placeholder

    const debtScore = 0.5 * (1 - isolation) + 0.3 * ageScore + 0.2 * (1 - Math.min(1, changeFreq / 10))
    results.push({ blobHash: r.blob_hash, paths, debtScore, isolationScore: isolation, ageScore, changeFrequency: changeFreq })
  }
  return results.sort((a, b) => b.debtScore - a.debtScore).slice(0, top)
}
