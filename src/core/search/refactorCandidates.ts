/**
 * Refactoring Suggestions — find pairs of symbols/chunks that are semantically
 * similar enough to be refactoring candidates.
 */
import { getActiveSession } from '../db/sqlite.js'
import { cosineSimilarity } from './vectorSearch.js'

export interface RefactorPair {
  hashA: string
  pathA: string
  nameA?: string
  kindA?: string
  hashB: string
  pathB: string
  nameB?: string
  kindB?: string
  similarity: number
  level: 'symbol' | 'chunk' | 'file'
}

export interface RefactorCandidatesOptions {
  threshold?: number
  topK?: number
  level?: 'symbol' | 'chunk' | 'file'
  branch?: string
}

export interface RefactorReport {
  pairs: RefactorPair[]
  threshold: number
  level: 'symbol' | 'chunk' | 'file'
  totalScanned: number
}

type Row = { blob_hash: string; vector: Buffer; path?: string; name?: string; kind?: string; chunk_id?: number; symbol_id?: number }

export function computeRefactorCandidates(options: RefactorCandidatesOptions = {}): RefactorReport {
  const { threshold = 0.88, topK = 50, level = 'symbol' } = options
  const { rawDb } = getActiveSession()

  let rows: Row[]

  if (level === 'symbol') {
    rows = rawDb.prepare(`
      SELECT se.blob_hash, se.vector, p.path, s.name, s.kind
      FROM symbol_embeddings se
      JOIN symbols s ON s.id = se.symbol_id
      JOIN paths p ON p.blob_hash = se.blob_hash
      GROUP BY se.symbol_id
      LIMIT 2000
    `).all() as Row[]
  } else if (level === 'chunk') {
    rows = rawDb.prepare(`
      SELECT ce.blob_hash, ce.vector, p.path
      FROM chunk_embeddings ce
      JOIN paths p ON p.blob_hash = ce.blob_hash
      GROUP BY ce.chunk_id
      LIMIT 2000
    `).all() as Row[]
  } else {
    rows = rawDb.prepare(`
      SELECT e.blob_hash, e.vector, p.path
      FROM embeddings e
      JOIN paths p ON p.blob_hash = e.blob_hash
      WHERE e.quantized = 0 OR e.quantized IS NULL
      GROUP BY e.blob_hash
      LIMIT 2000
    `).all() as Row[]
  }

  // Decode vectors
  type Decoded = { row: Row; vec: Float32Array }
  const decoded: Decoded[] = rows.map((r) => ({
    row: r,
    vec: new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
  }))

  const pairs: RefactorPair[] = []
  const n = decoded.length

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip same blob (trivially identical)
      if (decoded[i].row.blob_hash === decoded[j].row.blob_hash) continue
      const sim = cosineSimilarity(decoded[i].vec, decoded[j].vec)
      if (sim >= threshold) {
        pairs.push({
          hashA: decoded[i].row.blob_hash,
          pathA: decoded[i].row.path ?? '',
          nameA: decoded[i].row.name,
          kindA: decoded[i].row.kind,
          hashB: decoded[j].row.blob_hash,
          pathB: decoded[j].row.path ?? '',
          nameB: decoded[j].row.name,
          kindB: decoded[j].row.kind,
          similarity: sim,
          level,
        })
      }
    }
    if (pairs.length >= topK * 10) break
  }

  pairs.sort((a, b) => b.similarity - a.similarity)

  return {
    pairs: pairs.slice(0, topK),
    threshold,
    level,
    totalScanned: n,
  }
}
