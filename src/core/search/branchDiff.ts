import { getActiveSession } from '../db/sqlite.js'
import { paths } from '../db/schema.js'
import { cosineSimilarity } from './vectorSearch.js'

export interface BranchDiffEntry {
  blobHash: string
  path: string
  /** Similarity score if a query was provided, undefined otherwise */
  score?: number
}

export interface BranchDiffResult {
  branch1: string
  branch2: string
  uniqueToBranch1: BranchDiffEntry[]
  uniqueToBranch2: BranchDiffEntry[]
  shared: number
}

function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

export function computeBranchDiff(
  branch1: string,
  branch2: string,
  options: { topK?: number; queryEmbedding?: number[] } = {},
): BranchDiffResult {
  const { topK = 20, queryEmbedding } = options
  const { db, rawDb } = getActiveSession()

  const rows1 = rawDb.prepare('SELECT DISTINCT blob_hash FROM blob_branches WHERE branch_name = ?').all(branch1) as Array<{ blob_hash: string }>
  const rows2 = rawDb.prepare('SELECT DISTINCT blob_hash FROM blob_branches WHERE branch_name = ?').all(branch2) as Array<{ blob_hash: string }>

  const set1 = new Set(rows1.map((r) => r.blob_hash))
  const set2 = new Set(rows2.map((r) => r.blob_hash))

  let shared = 0
  for (const h of set1) if (set2.has(h)) shared++

  const unique1 = [...set1].filter((h) => !set2.has(h))
  const unique2 = [...set2].filter((h) => !set1.has(h))

  // Helper to resolve the representative path per blob (shortest path)
  function resolvePaths(blobHashes: string[]): Map<string, string> {
    const result = new Map<string, string>()
    if (blobHashes.length === 0) return result
    // Query paths for these blobs
    const placeholders = blobHashes.map(() => '?').join(',')
    const stmt = rawDb.prepare(`SELECT blob_hash, path FROM paths WHERE blob_hash IN (${placeholders})`)
    const rows = stmt.all(...blobHashes) as Array<{ blob_hash: string; path: string }>
    const grouped = new Map<string, string[]>()
    for (const r of rows) {
      const list = grouped.get(r.blob_hash) ?? []
      list.push(r.path)
      grouped.set(r.blob_hash, list)
    }
    for (const b of blobHashes) {
      const list = grouped.get(b) ?? []
      if (list.length === 0) continue
      // pick shortest path (then first)
      list.sort((a, b2) => a.length - b2.length || a.localeCompare(b2))
      result.set(b, list[0])
    }
    return result
  }

  // Build entries
  const top = topK
  const entries1: BranchDiffEntry[] = []
  const entries2: BranchDiffEntry[] = []

  const paths1 = resolvePaths(unique1)
  const paths2 = resolvePaths(unique2)

  if (queryEmbedding) {
    // Fetch embeddings for the union of unique blobs
    const allUnique = Array.from(new Set([...unique1, ...unique2]))
    const embeddingMap = new Map<string, number[]>()
    if (allUnique.length > 0) {
      const placeholders = allUnique.map(() => '?').join(',')
      const stmt = rawDb.prepare(`SELECT blob_hash, vector FROM embeddings WHERE blob_hash IN (${placeholders})`)
      const rows = stmt.all(...allUnique) as Array<{ blob_hash: string; vector: Buffer }>
      for (const r of rows) {
        try {
          embeddingMap.set(r.blob_hash, bufferToEmbedding(r.vector))
        } catch {
          // ignore malformed vectors
        }
      }
    }

    for (const b of unique1) {
      const path = paths1.get(b) ?? ''
      const emb = embeddingMap.get(b)
      const score = emb ? cosineSimilarity(queryEmbedding, emb) : 0
      entries1.push({ blobHash: b, path, score })
    }
    for (const b of unique2) {
      const path = paths2.get(b) ?? ''
      const emb = embeddingMap.get(b)
      const score = emb ? cosineSimilarity(queryEmbedding, emb) : 0
      entries2.push({ blobHash: b, path, score })
    }

    // Sort by score desc and limit
    entries1.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    entries2.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    return {
      branch1,
      branch2,
      uniqueToBranch1: entries1.slice(0, top),
      uniqueToBranch2: entries2.slice(0, top),
      shared,
    }
  }

  // No query: sort alphabetically by path
  for (const b of unique1) {
    const path = paths1.get(b) ?? ''
    entries1.push({ blobHash: b, path })
  }
  for (const b of unique2) {
    const path = paths2.get(b) ?? ''
    entries2.push({ blobHash: b, path })
  }

  entries1.sort((a, b) => a.path.localeCompare(b.path))
  entries2.sort((a, b) => a.path.localeCompare(b.path))

  return {
    branch1,
    branch2,
    uniqueToBranch1: entries1.slice(0, top),
    uniqueToBranch2: entries2.slice(0, top),
    shared,
  }
}
