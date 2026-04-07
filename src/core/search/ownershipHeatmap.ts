import { vectorSearch } from './vectorSearch.js'
import { getActiveSession } from '../db/sqlite.js'
import type { Embedding } from '../models/types.js'

export interface OwnershipEntry {
  authorName: string
  authorEmail: string
  totalBlobs: number
  recentBlobs: number
  ownershipScore: number
  trend: 'gaining' | 'stable' | 'fading'
  topPaths: string[]
}

export function computeOwnershipHeatmap(opts: { embedding: Embedding; topK?: number; windowDays?: number }): OwnershipEntry[] {
  const { embedding, topK = 5, windowDays = 90 } = opts
  // Find top matching blobs
  const results = vectorSearch(embedding, { topK: topK * 20 }) // fetch more candidates for ranking
  if (!results || results.length === 0) return []

  const { rawDb } = getActiveSession()
  const blobHashes = results.map((r) => r.blobHash)

  // Query commits/authors for these blobs in one go
  const placeholders = blobHashes.map(() => '?').join(',')
  const rows = rawDb.prepare(
    `SELECT bc.blob_hash as blobHash, c.author_name as authorName, c.author_email as authorEmail, c.timestamp as ts FROM blob_commits bc JOIN commits c ON c.commit_hash = bc.commit_hash WHERE bc.blob_hash IN (${placeholders})`
  ).all(...blobHashes) as Array<{ blobHash: string; authorName: string | null; authorEmail: string | null; ts: number }>

  // Map author -> set of blobs and recent blobs
  const byAuthor = new Map<string, { name: string; email: string; blobs: Set<string>; recent: Set<string> }>()
  const nowSec = Math.floor(Date.now() / 1000)
  const recentCut = nowSec - windowDays * 24 * 60 * 60

  for (const r of rows) {
    const name = r.authorName ?? 'Unknown'
    const email = r.authorEmail ?? ''
    const key = `${name}\u0000${email}`
    let entry = byAuthor.get(key)
    if (!entry) {
      entry = { name, email, blobs: new Set(), recent: new Set() }
      byAuthor.set(key, entry)
    }
    entry.blobs.add(r.blobHash)
    if (r.ts >= recentCut) entry.recent.add(r.blobHash)
  }

  // Top paths per author
  const pathRows = rawDb.prepare(
    `SELECT blob_hash as blobHash, path FROM paths WHERE blob_hash IN (${placeholders})`
  ).all(...blobHashes) as Array<{ blobHash: string; path: string }>

  const pathsByBlob = new Map<string, string[]>()
  for (const p of pathRows) {
    const arr = pathsByBlob.get(p.blobHash) ?? []
    arr.push(p.path)
    pathsByBlob.set(p.blobHash, arr)
  }

  // Build entries
  const entries: OwnershipEntry[] = []
  let maxTotal = 0
  for (const [key, val] of byAuthor) {
    const total = val.blobs.size
    if (total > maxTotal) maxTotal = total
  }

  for (const [key, val] of byAuthor) {
    const total = val.blobs.size
    const recent = val.recent.size
    const ownershipScore = maxTotal === 0 ? 0 : (recent * 2 + total) / (maxTotal * 3)
    const historic = total - recent
    let trend: OwnershipEntry['trend'] = 'stable'
    if (historic === 0 && recent > 0) trend = 'gaining'
    else if (recent < historic / 2) trend = 'fading'
    else trend = 'stable'

    // topPaths: gather paths from their blobs sorted by frequency
    const pathCount = new Map<string, number>()
    for (const bh of val.blobs) {
      const ps = pathsByBlob.get(bh) ?? []
      for (const p of ps) pathCount.set(p, (pathCount.get(p) ?? 0) + 1)
    }
    const topPaths = Array.from(pathCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p)

    entries.push({ authorName: val.name, authorEmail: val.email, totalBlobs: total, recentBlobs: recent, ownershipScore: Math.max(0, Math.min(1, ownershipScore)), trend, topPaths })
  }

  // Sort by ownershipScore desc and return top topK
  entries.sort((a, b) => b.ownershipScore - a.ownershipScore)
  return entries.slice(0, topK)
}
