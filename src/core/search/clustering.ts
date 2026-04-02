import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths } from '../db/schema.js'
import { logger } from '../../utils/logger.js'
import { cosineSimilarity } from './vectorSearch.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClusterInfo {
  id: number
  label: string
  centroid: number[]
  size: number
  representativePaths: string[]
  topKeywords: string[]
}

export interface ConceptEdge {
  fromId: number
  toId: number
  similarity: number
}

export interface ClusterReport {
  clusters: ClusterInfo[]
  edges: ConceptEdge[]
  totalBlobs: number
  k: number
  clusteredAt: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

function embeddingToBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec)
  return Buffer.from(f32.buffer)
}

function squaredEuclidean(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    s += d * d
  }
  return s
}

// ---------------------------------------------------------------------------
// Exported algorithm primitives
// ---------------------------------------------------------------------------

export function kMeansInit(vectors: number[][], k: number): number[][] {
  if (vectors.length === 0) return []
  const n = vectors.length
  k = Math.min(k, n)
  const dim = vectors[0].length
  const centroids: number[][] = []
  // pick first centroid randomly
  const firstIdx = Math.floor(Math.random() * n)
  centroids.push(vectors[firstIdx].slice())

  while (centroids.length < k) {
    // for each vector compute distance to nearest centroid
    const distances = new Array<number>(n)
    let total = 0
    for (let i = 0; i < n; i++) {
      let minD = Infinity
      for (const c of centroids) {
        const d = squaredEuclidean(vectors[i], c)
        if (d < minD) minD = d
      }
      distances[i] = minD
      total += minD
    }

    if (total === 0) {
      // all vectors equal to centroids — pick random remaining
      for (let i = 0; i < n && centroids.length < k; i++) {
        const v = vectors[i]
        if (!centroids.some((c) => c.every((x, idx) => x === v[idx]))) centroids.push(v.slice())
      }
      break
    }

    // choose next centroid with probability proportional to distance
    let r = Math.random() * total
    let chosen = -1
    for (let i = 0; i < n; i++) {
      r -= distances[i]
      if (r <= 0) { chosen = i; break }
    }
    if (chosen === -1) chosen = n - 1
    centroids.push(vectors[chosen].slice())
  }

  return centroids
}

export function assignClusters(vectors: number[][], centroids: number[][]): number[] {
  const assignments: number[] = []
  for (const v of vectors) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < centroids.length; i++) {
      const d = squaredEuclidean(v, centroids[i])
      if (d < bestD) { bestD = d; best = i }
    }
    assignments.push(best)
  }
  return assignments
}

export function updateCentroids(vectors: number[][], assignments: number[], k: number): number[][] {
  if (vectors.length === 0) return []
  const dim = vectors[0].length
  const sums: number[][] = new Array(k).fill(0).map(() => new Array(dim).fill(0))
  const counts = new Array<number>(k).fill(0)
  for (let i = 0; i < vectors.length; i++) {
    const a = assignments[i]
    counts[a]++
    const v = vectors[i]
    for (let d = 0; d < dim; d++) sums[a][d] += v[d]
  }
  const centroids: number[][] = new Array(k)
  for (let c = 0; c < k; c++) {
    if (counts[c] === 0) {
      // empty cluster: set to zeros
      centroids[c] = new Array(dim).fill(0)
    } else {
      centroids[c] = sums[c].map((s) => s / counts[c])
    }
  }
  return centroids
}

const DEFAULT_STOP_WORDS = new Set([
  'the','and','for','not','this','that','with','are','was','from','have','will','been','but','its','can'
])

export function extractKeywords(text: string, topN: number): string[] {
  const tokens = text.split(/\W+/).map((t) => t.toLowerCase()).filter(Boolean)
  const freq = new Map<string, number>()
  for (const t of tokens) {
    if (t.length < 3) continue
    if (DEFAULT_STOP_WORDS.has(t)) continue
    const c = freq.get(t) ?? 0
    freq.set(t, c + 1)
  }
  const arr = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])
  return arr.slice(0, topN).map((x) => x[0])
}

// ---------------------------------------------------------------------------
// Main computeClusters
// ---------------------------------------------------------------------------

export async function computeClusters(opts: {
  k?: number
  maxIterations?: number
  edgeThreshold?: number
  topKeywords?: number
  topPaths?: number
} = {}): Promise<ClusterReport> {
  const kOpt = opts.k ?? 8
  const maxIterations = opts.maxIterations ?? 20
  const edgeThreshold = opts.edgeThreshold ?? 0.3
  const topKeywordsN = opts.topKeywords ?? 5
  const topPaths = opts.topPaths ?? 5

  const { db, rawDb } = getActiveSession()

  // load embeddings
  const rows = db.select({ blobHash: embeddings.blobHash, vector: embeddings.vector }).from(embeddings).all()
  const totalBlobs = rows.length
  if (totalBlobs === 0) {
    return { clusters: [], edges: [], totalBlobs: 0, k: 0, clusteredAt: Math.floor(Date.now() / 1000) }
  }
  const vectors: number[][] = rows.map((r) => bufferToEmbedding(r.vector as Buffer))
  const blobHashes: string[] = rows.map((r) => r.blobHash)

  const k = Math.min(kOpt, vectors.length)

  // init
  let centroids = kMeansInit(vectors, k)

  let assignments = assignClusters(vectors, centroids)
  for (let iter = 0; iter < maxIterations; iter++) {
    const newCentroids = updateCentroids(vectors, assignments, k)
    const newAssignments = assignClusters(vectors, newCentroids)
    const same = newAssignments.every((v, i) => v === assignments[i])
    centroids = newCentroids
    assignments = newAssignments
    if (same) break
  }

  // group blobs per cluster
  const clustersMap = new Map<number, string[]>()
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i]
    const list = clustersMap.get(a) ?? []
    list.push(blobHashes[i])
    clustersMap.set(a, list)
  }

  const clusteredAt = Math.floor(Date.now() / 1000)

  // prepare cluster metadata
  type PartialCluster = {
    label: string
    centroid: number[]
    size: number
    representativePaths: string[]
    topKeywords: string[]
    blobHashes: string[]
  }

  const partials: PartialCluster[] = []

  for (let ci = 0; ci < k; ci++) {
    const assigned = clustersMap.get(ci) ?? []
    const size = assigned.length
    // find representative blob hashes sorted by distance to centroid
    const distances = assigned.map((h) => {
      const idx = blobHashes.indexOf(h)
      const vec = vectors[idx]
      return { hash: h, d: squaredEuclidean(vec, centroids[ci]) }
    }).sort((a, b) => a.d - b.d)

    const topBlobHashes = distances.slice(0, topPaths).map((x) => x.hash)

    // resolve paths for these blobs
    let repPaths: string[] = []
    if (topBlobHashes.length > 0) {
      const placeholders = topBlobHashes.map(() => '?').join(',')
      const stmt = rawDb.prepare(`SELECT blob_hash, path FROM paths WHERE blob_hash IN (${placeholders})`)
      const rows = stmt.all(...topBlobHashes) as Array<{ blob_hash: string; path: string }>
      const pathByHash = new Map<string, string[]>()
      for (const r of rows) {
        const list = pathByHash.get(r.blob_hash) ?? []
        list.push(r.path)
        pathByHash.set(r.blob_hash, list)
      }
      for (const h of topBlobHashes) {
        const p = pathByHash.get(h) ?? []
        if (p.length > 0) repPaths.push(p[0])
      }
    }

    // extract keywords from FTS5
    let keywords: string[] = []
    if (assigned.length > 0) {
      const placeholders = assigned.map(() => '?').join(',')
      const stmt = rawDb.prepare(`SELECT content FROM blob_fts WHERE blob_hash IN (${placeholders})`)
      const rows = stmt.all(...assigned) as Array<{ content: string }>
      const combined = rows.map((r) => r.content).join(' ')
      keywords = extractKeywords(combined, topKeywordsN)
    }

    // label: most common directory prefix among repPaths
    let label = ''
    if (repPaths.length > 0) {
      const prefixes = repPaths.map((p) => {
        const parts = p.split('/')
        return parts.slice(0, 2).join('/')
      })
      const counts = new Map<string, number>()
      for (const pr of prefixes) counts.set(pr, (counts.get(pr) ?? 0) + 1)
      const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
      label = sorted[0][0]
    } else {
      label = `cluster-${ci + 1}`
    }

    partials.push({ label, centroid: centroids[ci], size, representativePaths: repPaths, topKeywords: keywords, blobHashes: assigned })
  }

  // Persist atomically
  const insertClusterStmt = rawDb.prepare(`INSERT INTO blob_clusters (label, centroid, size, representative_paths, top_keywords, clustered_at) VALUES (?, ?, ?, ?, ?, ?)`)
  const insertAssignmentStmt = rawDb.prepare(`INSERT INTO cluster_assignments (blob_hash, cluster_id) VALUES (?, ?)`)

  const transaction = rawDb.transaction(() => {
    rawDb.prepare('DELETE FROM cluster_assignments').run()
    rawDb.prepare('DELETE FROM blob_clusters').run()

    const assignedIds: number[] = []
    for (const p of partials) {
      const buf = embeddingToBuffer(p.centroid)
      const res = insertClusterStmt.run(p.label, buf, p.size, JSON.stringify(p.representativePaths), JSON.stringify(p.topKeywords), clusteredAt)
      assignedIds.push(Number(res.lastInsertRowid))
    }

    // insert assignments
    for (let ci = 0; ci < partials.length; ci++) {
      const clusterId = assignedIds[ci]
      for (const h of partials[ci].blobHashes) {
        insertAssignmentStmt.run(h, clusterId)
      }
    }

    return assignedIds
  })

  let assignedIds: number[] = []
  try {
    assignedIds = transaction()
  } catch (err) {
    logger.error(`Clustering transaction failed: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  }

  // build ClusterReport
  const clusters: ClusterInfo[] = []
  for (let i = 0; i < partials.length; i++) {
    clusters.push({
      id: assignedIds[i],
      label: partials[i].label,
      centroid: partials[i].centroid,
      size: partials[i].size,
      representativePaths: partials[i].representativePaths,
      topKeywords: partials[i].topKeywords,
    })
  }

  // build edges
  const edges: ConceptEdge[] = []
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid)
      if (sim > edgeThreshold) {
        edges.push({ fromId: clusters[i].id, toId: clusters[j].id, similarity: sim })
      }
    }
  }

  const report: ClusterReport = { clusters, edges, totalBlobs, k, clusteredAt }
  return report
}
