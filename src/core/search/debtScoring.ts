import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getActiveSession } from '../db/sqlite.js'
import { dequantizeVector, deserializeQuantized } from '../embedding/quantize.js'
import { cosineSimilarityPrecomputed, vectorNorm } from './vectorSearch.js'
import type { EmbeddingProvider } from '../embedding/provider.js'

export interface DebtResult {
  blobHash: string
  paths: string[]
  debtScore: number
  isolationScore: number
  ageScore: number
  changeFrequency: number
}

/**
 * Number of nearest neighbours used when computing isolation score.
 * Higher K is more accurate but also more expensive for the cosine scan path.
 */
const ISOLATION_K = 5

/** Directory where the HNSW VSS index files are stored. */
const DB_DIR = '.gitsema'

/**
 * Decodes a stored embedding row into a Float32Array.
 */
function decodeVector(buf: Buffer, quantized: number, quantMin: number | null, quantScale: number | null): Float32Array {
  if (quantized === 1 && quantMin != null && quantScale != null) {
    return dequantizeVector(deserializeQuantized(buf, quantMin, quantScale))
  }
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

/**
 * Computes isolation scores for all blobs using a preloaded usearch HNSW index.
 *
 * For each blob, searches the index for its K nearest neighbours (excluding
 * itself) and returns the average distance (1 - cosine similarity) as the
 * isolation score.  A score near 1 means the blob is semantically unique;
 * near 0 means it is highly similar to its neighbours.
 *
 * @param usearchIndex   A loaded usearch Index instance.
 * @param idToHash       The numeric-ID → blob_hash mapping saved by build-vss.
 * @param hashToVec      Map from blob_hash to Float32Array for all blobs.
 * @returns Map<blobHash, isolationScore>
 */
function computeIsolationHnsw(
  usearchIndex: any,
  idToHash: string[],
  hashToVec: Map<string, Float32Array>,
): Map<string, number> {
  const scores = new Map<string, number>()
  // Build inverse map for fast lookup
  const hashToId = new Map<string, number>()
  for (let i = 0; i < idToHash.length; i++) hashToId.set(idToHash[i], i)

  for (const [hash, vec] of hashToVec) {
    try {
      // Request K+1 neighbours so we can discard the blob itself (distance ≈ 0)
      const res = usearchIndex.search(vec, ISOLATION_K + 1)
      const keys: number[] = (res as any).keys ?? (res as any).ids ?? []
      const distances: number[] = (res as any).distances ?? (res as any).dists ?? []
      const selfId = hashToId.get(hash)
      // Average the cosine distances for the K nearest neighbours (skip self)
      let sum = 0
      let count = 0
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === selfId) continue
        sum += distances[i] ?? 0
        count++
        if (count >= ISOLATION_K) break
      }
      scores.set(hash, count > 0 ? sum / count : 0.5)
    } catch {
      scores.set(hash, 0.5)
    }
  }
  return scores
}

/**
 * Computes isolation scores for all blobs via a full cosine scan.
 *
 * Loads every embedding for the given model, then for each blob computes
 * the average cosine similarity with its K nearest neighbours (excluding
 * itself).  The isolation score is (1 - average_similarity).
 *
 * This is O(N²) and memory-proportional to N×D, but is accurate and requires
 * no pre-built HNSW index.
 *
 * @param allRows  All embedding rows for the chosen model.
 * @returns Map<blobHash, isolationScore>
 */
export function computeIsolationCosineScan(
  allRows: Array<{ blob_hash: string; vec: Float32Array }>,
): Map<string, number> {
  const scores = new Map<string, number>()
  const norms = allRows.map((r) => vectorNorm(r.vec))

  for (let i = 0; i < allRows.length; i++) {
    const { blob_hash, vec } = allRows[i]
    const mag = norms[i]
    if (mag === 0) {
      scores.set(blob_hash, 0.5)
      continue
    }
    // Compute cosine similarity against all other blobs
    const sims: number[] = []
    for (let j = 0; j < allRows.length; j++) {
      if (j === i) continue
      const sim = cosineSimilarityPrecomputed(vec, mag, allRows[j].vec)
      sims.push(sim)
    }
    // Keep top-K similarities and average them
    sims.sort((a, b) => b - a)
    const topK = sims.slice(0, ISOLATION_K)
    // No neighbours → use 0.5 (neutral) rather than 1 (fully isolated)
    if (topK.length === 0) {
      scores.set(blob_hash, 0.5)
      continue
    }
    const avgSim = topK.reduce((s, v) => s + v, 0) / topK.length
    // isolation = 1 - avgSim (range [0,1]; 1 = highly isolated)
    scores.set(blob_hash, Math.max(0, Math.min(1, 1 - avgSim)))
  }
  return scores
}

export async function scoreDebt(
  dbSession: ReturnType<typeof getActiveSession>,
  _provider: EmbeddingProvider,
  opts: { top?: number; model?: string; branch?: string } = {},
): Promise<DebtResult[]> {
  const top = opts.top ?? 20
  const { rawDb } = dbSession
  const model = opts.model ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

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

  // ------------------------------------------------------------------
  // Compute isolation scores: try HNSW first, fall back to cosine scan
  // ------------------------------------------------------------------
  let isolationScores = new Map<string, number>()

  // Load all embeddings for the chosen model (needed for both paths)
  const embRows = rawDb.prepare(
    `SELECT blob_hash, vector, quantized, quant_min, quant_scale
     FROM embeddings WHERE model = ?`,
  ).all(model) as Array<{
    blob_hash: string; vector: Buffer
    quantized: number; quant_min: number | null; quant_scale: number | null
  }>

  if (embRows.length > 1) {
    const hashToVec = new Map<string, Float32Array>()
    for (const r of embRows) {
      hashToVec.set(r.blob_hash, decodeVector(r.vector, r.quantized, r.quant_min, r.quant_scale))
    }

    // Attempt HNSW path
    const safeName = model.replace(/[^a-zA-Z0-9._-]/g, '_')
    const indexPath = join(DB_DIR, `vectors-${safeName}.usearch`)
    const mapPath = join(DB_DIR, `vectors-${safeName}.map.json`)

    let usedHnsw = false
    if (existsSync(indexPath) && existsSync(mapPath)) {
      try {
        const usearch = await import('usearch')
        const idToHash: string[] = JSON.parse(readFileSync(mapPath, 'utf8'))
        const Index = (usearch as any).Index ?? (usearch as any).default?.Index
        let index: any = null
        if (Index) {
          if (typeof (Index as any).load === 'function') {
            index = (Index as any).load(indexPath)
          } else {
            index = new Index()
            if (typeof index.load === 'function') index.load(indexPath)
            else index = null
          }
        }
        if (index) {
          isolationScores = computeIsolationHnsw(index, idToHash, hashToVec)
          usedHnsw = true
        }
      } catch {
        // usearch not installed or index corrupt → fall through to cosine scan
      }
    }

    if (!usedHnsw) {
      // Cosine scan fallback: accurate, O(N²) but no external dependency
      const rows = Array.from(hashToVec.entries()).map(([blob_hash, vec]) => ({ blob_hash, vec }))
      isolationScores = computeIsolationCosineScan(rows)
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const results: DebtResult[] = []

  for (const row of blobStats) {
    const firstTs = row.first_ts ?? now
    const age = now - firstTs
    const ageScore = Math.min(1, age / (60 * 60 * 24 * 365))
    const changeFreq = row.change_freq || 0
    // Use computed isolation score; default to 0.5 if this blob has no embedding
    const isolation = isolationScores.get(row.blob_hash) ?? 0.5

    const debtScore = 0.5 * isolation + 0.3 * ageScore + 0.2 * (1 - Math.min(1, changeFreq / 10))
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
