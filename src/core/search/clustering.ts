import { execFileSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths } from '../db/schema.js'
import { logger } from '../../utils/logger.js'
import { cosineSimilarity } from './vectorSearch.js'
import { enhanceClusters, type EnhancedLabelOptions, type ClusterEnhancerInput } from './labelEnhancer.js'

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
  /**
   * Enhanced keywords derived from TF-IDF across all clusters (path tokens +
   * identifier splitting).  Populated when `useEnhancedLabels` is enabled in
   * the compute options; empty array otherwise.
   */
  enhancedKeywords: string[]
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

/**
 * A cluster snapshot computed at a specific point in time (or over all blobs).
 * Unlike `ClusterReport`, this includes the full per-blob assignment map and
 * is NOT persisted to the database — it is computed in-memory for comparison.
 */
export interface ClusterSnapshot {
  report: ClusterReport
  /** Maps blob_hash → cluster id in this snapshot */
  assignments: Map<string, number>
}

/**
 * Describes how a single cluster changed between two snapshots.
 * Either `afterCluster` (for clusters present in the "after" snapshot) or
 * `beforeCluster` (for dissolved clusters only in the "before" snapshot) may
 * be null, but not both.
 */
export interface ClusterChange {
  /** Cluster in the after snapshot; null for dissolved (before-only) clusters */
  afterCluster: ClusterInfo | null
  /** Best-matching cluster in the before snapshot; null for brand-new clusters */
  beforeCluster: ClusterInfo | null
  /**
   * 1 − cosineSimilarity(beforeCentroid, afterCentroid).
   * -1 when either cluster is null (no centroid to compare).
   */
  centroidDrift: number
  /** Blobs present in both snapshots that stayed in the matched cluster pair */
  stable: number
  /** Blobs new to the after snapshot (appeared after ref1) in this after-cluster */
  newBlobs: number
  /** Blobs from the matched before-cluster that are absent from the after snapshot */
  removedBlobs: number
  /** Blobs that migrated into this after-cluster from a different before-cluster */
  inflows: Array<{ fromClusterLabel: string; count: number }>
  /** Blobs that left the matched before-cluster to land in a different after-cluster */
  outflows: Array<{ toClusterLabel: string; count: number }>
}

/**
 * Full diff report returned by `compareClusterSnapshots`.
 */
export interface TemporalClusterReport {
  ref1: string
  ref2: string
  before: ClusterReport
  after: ClusterReport
  changes: ClusterChange[]
  newBlobsTotal: number
  removedBlobsTotal: number
  movedBlobsTotal: number
  stableBlobsTotal: number
}

/**
 * A single step in a cluster timeline — clusters at one point in time plus the
 * changes from the previous step (null for the first step).
 */
export interface ClusterTimelineStep {
  /** Human-readable reference string for this step (formatted date). */
  ref: string
  /** Unix timestamp (seconds) used as the cutoff for this step. */
  timestamp: number
  /** Number of blobs visible at this step. */
  blobCount: number
  /** Cluster summary for this step. */
  clusters: Array<{
    id: number
    label: string
    size: number
    topKeywords: string[]
    representativePaths: string[]
    enhancedKeywords: string[]
  }>
  /**
   * Structural changes relative to the previous step.
   * Null for the first step (no prior state to compare to).
   */
  changes: ClusterChange[] | null
  /** Aggregate blob-movement stats relative to the previous step. */
  stats: {
    newBlobs: number
    removedBlobs: number
    movedBlobs: number
    stableBlobs: number
  } | null
  /** Ref label of the previous step (null for first step). */
  prevRef: string | null
}

/**
 * Full cluster timeline produced by `computeClusterTimeline`.
 */
export interface ClusterTimelineReport {
  /** Ordered chronological steps (oldest first). */
  steps: ClusterTimelineStep[]
  k: number
  /** Unix timestamp of the earliest step. */
  since: number
  /** Unix timestamp of the latest step. */
  until: number
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
// Labeling helpers
// ---------------------------------------------------------------------------

/**
 * Returns the most common directory prefix (up to 2 levels deep) among the
 * provided file paths, or an empty string when the input array is empty.
 */
function buildPathPrefix(paths: string[]): string {
  if (paths.length === 0) return ''
  const prefixes = paths.map((p) => {
    const parts = p.split('/')
    return parts.length >= 2 ? parts.slice(0, 2).join('/') : parts[0]
  })
  const counts = new Map<string, number>()
  for (const pr of prefixes) counts.set(pr, (counts.get(pr) ?? 0) + 1)
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  return sorted[0][0]
}

// ---------------------------------------------------------------------------
// Shared internal types
// ---------------------------------------------------------------------------

interface PartialCluster {
  label: string
  centroid: number[]
  size: number
  representativePaths: string[]
  topKeywords: string[]
  blobHashes: string[]
  /** Combined FTS content for all assigned blobs — used by the label enhancer. */
  rawFtsContent: string
  /** All paths resolved for assigned blobs — used by the label enhancer. */
  allPaths: string[]
}

// ---------------------------------------------------------------------------
// Internal helper: run k-means and build rich cluster metadata
// ---------------------------------------------------------------------------

/**
 * Core k-means computation shared by `computeClusters` (persisted) and
 * `computeClusterSnapshot` (in-memory, temporal).
 *
 * @param inputVectors  - pre-loaded embedding vectors (parallel array with inputHashes)
 * @param inputHashes   - blob hashes corresponding to inputVectors
 * @param k             - target number of clusters
 * @param maxIterations - k-means iteration cap
 * @param topPaths      - number of representative paths to include per cluster
 * @param topKeywordsN  - number of keywords to extract per cluster
 * @param rawDb         - raw better-sqlite3 connection (for paths + FTS5 lookups)
 */
function buildClusterPartials(
  inputVectors: number[][],
  inputHashes: string[],
  k: number,
  maxIterations: number,
  topPaths: number,
  topKeywordsN: number,
  rawDb: InstanceType<typeof Database>,
): { partials: PartialCluster[]; assignments: number[] } {
  const actualK = Math.min(k, inputVectors.length)

  let centroids = kMeansInit(inputVectors, actualK)
  let assignments = assignClusters(inputVectors, centroids)

  for (let iter = 0; iter < maxIterations; iter++) {
    const newCentroids = updateCentroids(inputVectors, assignments, actualK)
    const newAssignments = assignClusters(inputVectors, newCentroids)
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
    list.push(inputHashes[i])
    clustersMap.set(a, list)
  }

  const partials: PartialCluster[] = []

  for (let ci = 0; ci < actualK; ci++) {
    const assigned = clustersMap.get(ci) ?? []
    const size = assigned.length

    // find representative blob hashes sorted by distance to centroid
    const distances = assigned.map((h) => {
      const idx = inputHashes.indexOf(h)
      const vec = inputVectors[idx]
      return { hash: h, d: squaredEuclidean(vec, centroids[ci]) }
    }).sort((a, b) => a.d - b.d)

    const topBlobHashes = distances.slice(0, topPaths).map((x) => x.hash)

    // resolve paths for the top blobs (representative) and all blobs (for enhancer)
    let repPaths: string[] = []
    let allPathsForCluster: string[] = []
    if (assigned.length > 0) {
      // All paths for the cluster (used by label enhancer)
      const allPlaceholders = assigned.map(() => '?').join(',')
      const allPathRows = (rawDb.prepare(
        `SELECT path FROM paths WHERE blob_hash IN (${allPlaceholders})`
      ).all(...assigned) as Array<{ path: string }>)
      allPathsForCluster = allPathRows.map((r) => r.path)
    }
    if (topBlobHashes.length > 0) {
      const placeholders = topBlobHashes.map(() => '?').join(',')
      const stmt = rawDb.prepare(`SELECT blob_hash, path FROM paths WHERE blob_hash IN (${placeholders})`)
      const pathRows = stmt.all(...topBlobHashes) as Array<{ blob_hash: string; path: string }>
      const pathByHash = new Map<string, string[]>()
      for (const r of pathRows) {
        const list = pathByHash.get(r.blob_hash) ?? []
        list.push(r.path)
        pathByHash.set(r.blob_hash, list)
      }
      for (const h of topBlobHashes) {
        const p = pathByHash.get(h) ?? []
        if (p.length > 0) repPaths.push(p[0])
      }
    }

    // extract keywords from FTS5 content
    let keywords: string[] = []
    let rawFtsContent = ''
    if (assigned.length > 0) {
      const placeholders = assigned.map(() => '?').join(',')
      const stmt = rawDb.prepare(`SELECT content FROM blob_fts WHERE blob_hash IN (${placeholders})`)
      const ftsRows = stmt.all(...assigned) as Array<{ content: string }>
      rawFtsContent = ftsRows.map((r) => r.content).join(' ')
      keywords = extractKeywords(rawFtsContent, topKeywordsN)
    }

    // label: semantic keywords combined with the most common directory prefix
    const pathPrefix = buildPathPrefix(repPaths)
    const topWords = keywords.slice(0, 3).join(' ')
    let label = ''
    if (topWords && pathPrefix) {
      label = `${topWords} (${pathPrefix})`
    } else if (topWords) {
      label = topWords
    } else if (pathPrefix) {
      label = pathPrefix
    } else {
      label = `cluster-${ci + 1}`
    }

    partials.push({
      label,
      centroid: centroids[ci],
      size,
      representativePaths: repPaths,
      topKeywords: keywords,
      blobHashes: assigned,
      rawFtsContent,
      allPaths: allPathsForCluster,
    })
  }

  return { partials, assignments }
}

/** Build the `ConceptEdge` list from a set of clusters. */
function buildEdges(clusters: ClusterInfo[], edgeThreshold: number): ConceptEdge[] {
  const edges: ConceptEdge[] = []
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid)
      if (sim > edgeThreshold) {
        edges.push({ fromId: clusters[i].id, toId: clusters[j].id, similarity: sim })
      }
    }
  }
  return edges
}

// ---------------------------------------------------------------------------
// Main computeClusters (persisted — Phase 21 behaviour unchanged)
// ---------------------------------------------------------------------------

export async function computeClusters(opts: {
  k?: number
  maxIterations?: number
  edgeThreshold?: number
  topKeywords?: number
  topPaths?: number
  /** When true, enhance cluster labels with TF-IDF keyword extraction (default: false) */
  useEnhancedLabels?: boolean
  /** Number of enhanced keywords to compute per cluster (default: 5) */
  enhancedKeywordsN?: number
} = {}): Promise<ClusterReport> {
  const kOpt = opts.k ?? 8
  const maxIterations = opts.maxIterations ?? 20
  const edgeThreshold = opts.edgeThreshold ?? 0.3
  const topKeywordsN = opts.topKeywords ?? 5
  const topPaths = opts.topPaths ?? 5
  const useEnhancedLabels = opts.useEnhancedLabels ?? false
  const enhancedKeywordsN = opts.enhancedKeywordsN ?? 5

  const { db, rawDb } = getActiveSession()

  // load all embeddings
  const rows = db.select({ blobHash: embeddings.blobHash, vector: embeddings.vector }).from(embeddings).all()
  const totalBlobs = rows.length
  if (totalBlobs === 0) {
    return { clusters: [], edges: [], totalBlobs: 0, k: 0, clusteredAt: Math.floor(Date.now() / 1000) }
  }
  const vectors: number[][] = rows.map((r) => bufferToEmbedding(r.vector as Buffer))
  const blobHashes: string[] = rows.map((r) => r.blobHash)
  const clusteredAt = Math.floor(Date.now() / 1000)

  const { partials } = buildClusterPartials(vectors, blobHashes, kOpt, maxIterations, topPaths, topKeywordsN, rawDb)
  const actualK = partials.length

  // Optionally run label enhancer across all clusters
  const enhancerInputs: ClusterEnhancerInput[] = partials.map((p) => ({
    paths: p.allPaths,
    content: p.rawFtsContent,
    existingKeywords: p.topKeywords,
  }))
  const enhancedLabelOpts: EnhancedLabelOptions = { enabled: useEnhancedLabels, topN: enhancedKeywordsN }
  const enhancedResults = enhanceClusters(enhancerInputs, enhancedLabelOpts)

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

  const clusters: ClusterInfo[] = []
  for (let i = 0; i < partials.length; i++) {
    clusters.push({
      id: assignedIds[i],
      label: partials[i].label,
      centroid: partials[i].centroid,
      size: partials[i].size,
      representativePaths: partials[i].representativePaths,
      topKeywords: partials[i].topKeywords,
      enhancedKeywords: enhancedResults[i].keywords,
    })
  }

  const edges = buildEdges(clusters, edgeThreshold)
  return { clusters, edges, totalBlobs, k: actualK, clusteredAt }
}

// ---------------------------------------------------------------------------
// Temporal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a git ref (commit hash, branch, tag) or date string (YYYY-MM-DD /
 * ISO 8601) to a Unix timestamp in seconds.
 *
 * Resolution order:
 *  1. Try parsing as a JavaScript Date.
 *  2. Try running `git log -1 --format=%ct <ref>` in `repoPath`.
 *
 * @throws if neither approach produces a valid timestamp.
 */
export function resolveRefToTimestamp(ref: string, repoPath = '.'): number {
  // Try date string first (e.g. "2024-01-15" or "2024-01-15T12:00:00Z")
  const d = new Date(ref)
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000)

  // Try as a git ref using git log
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', ref], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const ts = parseInt(out, 10)
    if (!isNaN(ts) && ts > 0) return ts
  } catch {
    // fall through
  }

  throw new Error(
    `Cannot resolve "${ref}" to a timestamp. ` +
    `Expected a git ref (commit hash, branch, tag) or a date (YYYY-MM-DD / ISO 8601).`,
  )
}

/**
 * Returns the blob hashes (from the embeddings table) whose *earliest* commit
 * has a timestamp ≤ `timestamp`.  Blobs with no commit record are excluded.
 */
export function getBlobHashesUpTo(timestamp: number): string[] {
  const { rawDb } = getActiveSession()
  const rows = rawDb.prepare(`
    SELECT DISTINCT e.blob_hash
    FROM embeddings e
    JOIN blob_commits bc ON e.blob_hash = bc.blob_hash
    JOIN commits c ON bc.commit_hash = c.commit_hash
    WHERE c.timestamp <= ?
  `).all(timestamp) as Array<{ blob_hash: string }>
  return rows.map((r) => r.blob_hash)
}

// ---------------------------------------------------------------------------
// computeClusterSnapshot — in-memory, temporal (Phase 22)
// ---------------------------------------------------------------------------

/**
 * Compute clusters for a filtered set of blobs (e.g. those visible at a
 * specific point in time) **without** persisting anything to the database.
 *
 * The returned `ClusterSnapshot` includes the full per-blob assignment map
 * needed by `compareClusterSnapshots`.
 *
 * @param opts.blobHashFilter - if provided, only these blob hashes are clustered.
 *                              When omitted, all indexed blob hashes are used.
 */
export async function computeClusterSnapshot(opts: {
  blobHashFilter?: string[]
  k?: number
  maxIterations?: number
  edgeThreshold?: number
  topKeywords?: number
  topPaths?: number
  /** When true, enhance cluster labels with TF-IDF keyword extraction (default: false) */
  useEnhancedLabels?: boolean
  /** Number of enhanced keywords to compute per cluster (default: 5) */
  enhancedKeywordsN?: number
} = {}): Promise<ClusterSnapshot> {
  const kOpt = opts.k ?? 8
  const maxIterations = opts.maxIterations ?? 20
  const edgeThreshold = opts.edgeThreshold ?? 0.3
  const topKeywordsN = opts.topKeywords ?? 5
  const topPaths = opts.topPaths ?? 5
  const useEnhancedLabels = opts.useEnhancedLabels ?? false
  const enhancedKeywordsN = opts.enhancedKeywordsN ?? 5

  const { db, rawDb } = getActiveSession()

  // Load embeddings — optionally filtered
  let rows: Array<{ blobHash: string; vector: unknown }>
  if (opts.blobHashFilter !== undefined) {
    // An explicit filter was provided.
    // An empty array means "no blobs in this time window" — return immediately.
    if (opts.blobHashFilter.length === 0) {
      const emptyReport: ClusterReport = { clusters: [], edges: [], totalBlobs: 0, k: 0, clusteredAt: Math.floor(Date.now() / 1000) }
      return { report: emptyReport, assignments: new Map() }
    }
    // Fetch in one raw SQL call to avoid Drizzle IN() limitations with large arrays
    const placeholders = opts.blobHashFilter.map(() => '?').join(',')
    rows = (rawDb.prepare(
      `SELECT blob_hash, vector FROM embeddings WHERE blob_hash IN (${placeholders})`
    ).all(...opts.blobHashFilter) as Array<{ blob_hash: string; vector: Buffer }>).map((r) => ({
      blobHash: r.blob_hash,
      vector: r.vector,
    }))
  } else {
    rows = db.select({ blobHash: embeddings.blobHash, vector: embeddings.vector }).from(embeddings).all()
  }

  const totalBlobs = rows.length
  const clusteredAt = Math.floor(Date.now() / 1000)

  if (totalBlobs === 0) {
    const emptyReport: ClusterReport = { clusters: [], edges: [], totalBlobs: 0, k: 0, clusteredAt }
    return { report: emptyReport, assignments: new Map() }
  }

  const vectors: number[][] = rows.map((r) => bufferToEmbedding(r.vector as Buffer))
  const blobHashes: string[] = rows.map((r) => r.blobHash)

  const { partials, assignments: rawAssignments } = buildClusterPartials(
    vectors, blobHashes, kOpt, maxIterations, topPaths, topKeywordsN, rawDb,
  )
  const actualK = partials.length

  // Optionally run label enhancer across all clusters
  const enhancerInputs: ClusterEnhancerInput[] = partials.map((p) => ({
    paths: p.allPaths,
    content: p.rawFtsContent,
    existingKeywords: p.topKeywords,
  }))
  const enhancedLabelOpts: EnhancedLabelOptions = { enabled: useEnhancedLabels, topN: enhancedKeywordsN }
  const enhancedResults = enhanceClusters(enhancerInputs, enhancedLabelOpts)

  // Build ClusterInfo with sequential IDs (not persisted to DB)
  const clusters: ClusterInfo[] = partials.map((p, i) => ({
    id: i,
    label: p.label,
    centroid: p.centroid,
    size: p.size,
    representativePaths: p.representativePaths,
    topKeywords: p.topKeywords,
    enhancedKeywords: enhancedResults[i].keywords,
  }))

  const edges = buildEdges(clusters, edgeThreshold)
  const report: ClusterReport = { clusters, edges, totalBlobs, k: actualK, clusteredAt }

  // Build blob → cluster-id assignment map
  const assignmentMap = new Map<string, number>()
  for (let i = 0; i < blobHashes.length; i++) {
    const clusterIdx = rawAssignments[i]
    assignmentMap.set(blobHashes[i], clusters[clusterIdx].id)
  }

  return { report, assignments: assignmentMap }
}

// ---------------------------------------------------------------------------
// compareClusterSnapshots — produces a TemporalClusterReport (Phase 22)
// ---------------------------------------------------------------------------

/**
 * Compares two cluster snapshots and returns a `TemporalClusterReport` that
 * describes how blobs migrated between clusters from `ref1` to `ref2`.
 *
 * Cluster matching is done greedily by centroid cosine similarity: each
 * after-cluster is matched to the before-cluster with the highest similarity.
 * Unmatched after-clusters are "new"; unmatched before-clusters are "dissolved".
 */
export function compareClusterSnapshots(
  snapshot1: ClusterSnapshot,
  snapshot2: ClusterSnapshot,
  ref1: string,
  ref2: string,
): TemporalClusterReport {
  const before = snapshot1.report
  const after = snapshot2.report

  const beforeClusters = before.clusters
  const afterClusters = after.clusters

  // --- Greedy centroid matching (after → before) ---
  // Build similarity matrix
  const simMatrix: number[][] = afterClusters.map((ac) =>
    beforeClusters.map((bc) => cosineSimilarity(ac.centroid, bc.centroid)),
  )

  // Collect all (afterIdx, beforeIdx, sim) pairs and sort descending
  const pairs: Array<{ ai: number; bi: number; sim: number }> = []
  for (let ai = 0; ai < afterClusters.length; ai++) {
    for (let bi = 0; bi < beforeClusters.length; bi++) {
      pairs.push({ ai, bi, sim: simMatrix[ai][bi] })
    }
  }
  pairs.sort((a, b) => b.sim - a.sim)

  // Greedy assignment
  const matchedAfter = new Set<number>()
  const matchedBefore = new Set<number>()
  const afterToBeforeMatch = new Map<number, number>()  // afterIdx → beforeIdx
  const beforeToAfterMatch = new Map<number, number>()  // beforeIdx → afterIdx

  for (const { ai, bi, sim } of pairs) {
    if (matchedAfter.has(ai) || matchedBefore.has(bi)) continue
    if (sim < 0) break  // negative sim — not worth matching
    matchedAfter.add(ai)
    matchedBefore.add(bi)
    afterToBeforeMatch.set(ai, bi)
    beforeToAfterMatch.set(bi, ai)
  }

  // --- Blob-level migration analysis ---
  const beforeHashes = new Set(snapshot1.assignments.keys())
  const afterHashes = new Set(snapshot2.assignments.keys())

  // Build inverse maps: cluster-id → Set of blob hashes
  const beforeClusterBlobs = new Map<number, Set<string>>()
  for (const [hash, cid] of snapshot1.assignments) {
    let s = beforeClusterBlobs.get(cid)
    if (!s) { s = new Set(); beforeClusterBlobs.set(cid, s) }
    s.add(hash)
  }

  // Aggregate migration counts per (afterClusterId, beforeClusterId) pair
  // and per (beforeClusterId, afterClusterId) pair
  const inflowCounts = new Map<string, number>()   // key: `${afterId}:${fromId}`
  const outflowCounts = new Map<string, number>()  // key: `${beforeId}:${toId}`

  let newBlobsTotal = 0
  let removedBlobsTotal = 0
  let movedBlobsTotal = 0
  let stableBlobsTotal = 0

  // Track per-after-cluster counters
  const afterStable = new Map<number, number>()
  const afterNew = new Map<number, number>()
  const afterRemoved = new Map<number, number>()  // for the matched before-cluster

  for (const afterCluster of afterClusters) {
    afterStable.set(afterCluster.id, 0)
    afterNew.set(afterCluster.id, 0)
  }

  for (const [hash, afterCid] of snapshot2.assignments) {
    if (!beforeHashes.has(hash)) {
      // New blob
      afterNew.set(afterCid, (afterNew.get(afterCid) ?? 0) + 1)
      newBlobsTotal++
      continue
    }
    const beforeCid = snapshot1.assignments.get(hash)!
    const afterIdx = afterClusters.findIndex((c) => c.id === afterCid)
    const matchedBeforeIdx = afterToBeforeMatch.get(afterIdx)

    if (matchedBeforeIdx !== undefined && beforeClusters[matchedBeforeIdx].id === beforeCid) {
      // Blob stayed in the matched cluster pair
      afterStable.set(afterCid, (afterStable.get(afterCid) ?? 0) + 1)
      stableBlobsTotal++
    } else {
      // Blob moved to a different after-cluster
      movedBlobsTotal++
      const key = `${afterCid}:${beforeCid}`
      inflowCounts.set(key, (inflowCounts.get(key) ?? 0) + 1)
      const outKey = `${beforeCid}:${afterCid}`
      outflowCounts.set(outKey, (outflowCounts.get(outKey) ?? 0) + 1)
    }
  }

  // Count removed blobs (in before but not in after)
  for (const [hash, beforeCid] of snapshot1.assignments) {
    if (!afterHashes.has(hash)) {
      removedBlobsTotal++
      const prevCount = afterRemoved.get(beforeCid) ?? 0
      afterRemoved.set(beforeCid, prevCount + 1)
    }
  }

  // --- Build ClusterChange entries ---
  const changes: ClusterChange[] = []

  // One entry per after-cluster
  for (let ai = 0; ai < afterClusters.length; ai++) {
    const afterCluster = afterClusters[ai]
    const matchedBi = afterToBeforeMatch.get(ai)
    const beforeCluster = matchedBi !== undefined ? beforeClusters[matchedBi] : null

    const centroidDrift = beforeCluster !== null
      ? 1 - cosineSimilarity(beforeCluster.centroid, afterCluster.centroid)
      : -1

    const stable = afterStable.get(afterCluster.id) ?? 0
    const newBlobs = afterNew.get(afterCluster.id) ?? 0
    const removedBlobs = beforeCluster !== null ? (afterRemoved.get(beforeCluster.id) ?? 0) : 0

    // Inflows: blobs from other before-clusters that landed in this after-cluster
    const inflows: Array<{ fromClusterLabel: string; count: number }> = []
    for (const [key, count] of inflowCounts) {
      const [aCid, bCid] = key.split(':').map(Number)
      if (aCid !== afterCluster.id) continue
      const fromCluster = beforeClusters.find((c) => c.id === bCid)
      if (fromCluster) inflows.push({ fromClusterLabel: fromCluster.label, count })
    }
    inflows.sort((a, b) => b.count - a.count)

    // Outflows: blobs that left the matched before-cluster into other after-clusters
    const outflows: Array<{ toClusterLabel: string; count: number }> = []
    if (beforeCluster !== null) {
      for (const [key, count] of outflowCounts) {
        const [bCid, aCid] = key.split(':').map(Number)
        if (bCid !== beforeCluster.id) continue
        const toCluster = afterClusters.find((c) => c.id === aCid)
        if (toCluster) outflows.push({ toClusterLabel: toCluster.label, count })
      }
      outflows.sort((a, b) => b.count - a.count)
    }

    changes.push({ afterCluster, beforeCluster, centroidDrift, stable, newBlobs, removedBlobs, inflows, outflows })
  }

  // One entry per dissolved before-cluster (no after-cluster match)
  for (let bi = 0; bi < beforeClusters.length; bi++) {
    if (beforeToAfterMatch.has(bi)) continue
    const beforeCluster = beforeClusters[bi]
    const removedBlobs = afterRemoved.get(beforeCluster.id) ?? 0

    const outflows: Array<{ toClusterLabel: string; count: number }> = []
    for (const [key, count] of outflowCounts) {
      const [bCid, aCid] = key.split(':').map(Number)
      if (bCid !== beforeCluster.id) continue
      const toCluster = afterClusters.find((c) => c.id === aCid)
      if (toCluster) outflows.push({ toClusterLabel: toCluster.label, count })
    }
    outflows.sort((a, b) => b.count - a.count)

    changes.push({
      afterCluster: null,
      beforeCluster,
      centroidDrift: -1,
      stable: 0,
      newBlobs: 0,
      removedBlobs,
      inflows: [],
      outflows,
    })
  }

  return {
    ref1,
    ref2,
    before,
    after,
    changes,
    newBlobsTotal,
    removedBlobsTotal,
    movedBlobsTotal,
    stableBlobsTotal,
  }
}

// ---------------------------------------------------------------------------
// computeClusterTimeline — multi-step temporal cluster view (Phase 23)
// ---------------------------------------------------------------------------

/**
 * Computes clusters at `steps` evenly-spaced points in time across the indexed
 * commit history, then stitches consecutive snapshots together into a timeline
 * of cluster shifts and relabelings.
 *
 * @param opts.steps   - number of time checkpoints to sample (default 5)
 * @param opts.since   - earliest timestamp to include (unix seconds; defaults to earliest indexed commit)
 * @param opts.until   - latest timestamp to include (unix seconds; defaults to latest indexed commit)
 * @param opts.k       - number of clusters per snapshot (default 8)
 */
export async function computeClusterTimeline(opts: {
  steps?: number
  since?: number
  until?: number
  k?: number
  maxIterations?: number
  edgeThreshold?: number
  topPaths?: number
  topKeywords?: number
  /** When true, enhance cluster labels with TF-IDF keyword extraction (default: false) */
  useEnhancedLabels?: boolean
  /** Number of enhanced keywords to compute per cluster (default: 5) */
  enhancedKeywordsN?: number
} = {}): Promise<ClusterTimelineReport> {
  const steps = Math.max(1, opts.steps ?? 5)
  const kOpt = opts.k ?? 8
  const snapshotOpts = {
    k: kOpt,
    maxIterations: opts.maxIterations ?? 20,
    edgeThreshold: opts.edgeThreshold ?? 0.3,
    topPaths: opts.topPaths ?? 5,
    topKeywords: opts.topKeywords ?? 5,
    useEnhancedLabels: opts.useEnhancedLabels ?? false,
    enhancedKeywordsN: opts.enhancedKeywordsN ?? 5,
  }

  const { rawDb } = getActiveSession()

  // Find the timestamp range from the commits table
  const rangeRow = rawDb.prepare(`SELECT MIN(timestamp) AS minTs, MAX(timestamp) AS maxTs FROM commits`)
    .get() as { minTs: number | null; maxTs: number | null }

  if (rangeRow.minTs === null || rangeRow.maxTs === null) {
    return { steps: [], k: kOpt, since: 0, until: 0 }
  }

  const since = opts.since !== undefined ? Math.max(opts.since, rangeRow.minTs) : rangeRow.minTs
  const until = opts.until !== undefined ? Math.min(opts.until, rangeRow.maxTs) : rangeRow.maxTs

  // Generate evenly-spaced timestamps across [since, until]
  const timestamps: number[] = []
  if (steps === 1) {
    timestamps.push(until)
  } else {
    const interval = (until - since) / (steps - 1)
    for (let i = 0; i < steps; i++) {
      timestamps.push(Math.round(since + interval * i))
    }
  }

  // Snap each timestamp to the nearest real commit timestamp (≤ timestamp),
  // so that steps with no blobs get deduplicated cleanly.
  const snapTimestamps: number[] = timestamps.map((ts) => {
    const row = rawDb.prepare(
      `SELECT MAX(timestamp) AS ts FROM commits WHERE timestamp <= ?`
    ).get(ts) as { ts: number | null }
    return row.ts ?? ts
  })

  // Compute snapshots for each checkpoint
  const snapshots: ClusterSnapshot[] = []
  const effectiveTimestamps: number[] = []

  for (const ts of snapTimestamps) {
    const blobHashes = getBlobHashesUpTo(ts)
    const snapshot = await computeClusterSnapshot({ ...snapshotOpts, blobHashFilter: blobHashes })
    snapshots.push(snapshot)
    effectiveTimestamps.push(ts)
  }

  // Build timeline steps
  const timelineSteps: ClusterTimelineStep[] = []

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i]
    const ts = effectiveTimestamps[i]
    const ref = new Date(ts * 1000).toISOString().slice(0, 10)

    let changes: ClusterChange[] | null = null
    let stats: ClusterTimelineStep['stats'] = null
    let prevRef: string | null = null

    if (i > 0) {
      const prev = snapshots[i - 1]
      const prevTs = effectiveTimestamps[i - 1]
      prevRef = new Date(prevTs * 1000).toISOString().slice(0, 10)
      const diff = compareClusterSnapshots(prev, snap, prevRef, ref)
      changes = diff.changes
      stats = {
        newBlobs: diff.newBlobsTotal,
        removedBlobs: diff.removedBlobsTotal,
        movedBlobs: diff.movedBlobsTotal,
        stableBlobs: diff.stableBlobsTotal,
      }
    }

    timelineSteps.push({
      ref,
      timestamp: ts,
      blobCount: snap.report.totalBlobs,
      clusters: snap.report.clusters.map((c) => ({
        id: c.id,
        label: c.label,
        size: c.size,
        topKeywords: c.topKeywords,
        representativePaths: c.representativePaths,
        enhancedKeywords: c.enhancedKeywords,
      })),
      changes,
      stats,
      prevRef,
    })
  }

  return { steps: timelineSteps, k: kOpt, since, until }
}

// ---------------------------------------------------------------------------
// computeClusterChangePoints — detect structural change points (Phase 27)
// ---------------------------------------------------------------------------

/**
 * A pair of cluster descriptors matched between two consecutive snapshots,
 * along with the centroid drift between them.
 */
export interface ClusterMovingPair {
  beforeLabel: string
  afterLabel: string
  drift: number
}

/**
 * A single cluster-structure change point — one commit step where the
 * mean centroid drift score across matched clusters exceeded the threshold.
 */
export interface ClusterChangePoint {
  before: {
    ref: string
    timestamp: number
    clusters: Array<{ label: string; size: number; representativePaths: string[] }>
  }
  after: {
    ref: string
    timestamp: number
    clusters: Array<{ label: string; size: number; representativePaths: string[] }>
  }
  shiftScore: number
  topMovingPairs: ClusterMovingPair[]
}

/**
 * Full report produced by `computeClusterChangePoints`.
 */
export interface ClusterChangePointReport {
  type: 'cluster-change-points'
  k: number
  threshold: number
  range: { since: string; until: string }
  points: ClusterChangePoint[]
}

/**
 * Computes semantic cluster change points across Git history.
 *
 * For each sampled commit the function:
 *  1. Determines which blobs were visible as of that commit.
 *  2. Runs k-means clustering over those blobs.
 *  3. Greedily matches clusters between consecutive steps by centroid similarity.
 *  4. Computes a mean centroid shift score across matched pairs.
 *  5. Emits a change point when the score >= threshold.
 *
 * **Performance note:** Running k-means at every commit can be expensive on
 * large repositories.  Use `maxCommits` to cap the number of commits sampled
 * (commits are selected evenly across the since–until range when capped).
 *
 * Returns the top `topPoints` change points sorted by shift score descending.
 */
export async function computeClusterChangePoints(opts: {
  k?: number
  threshold?: number
  topPoints?: number
  since?: number
  until?: number
  maxCommits?: number
  maxIterations?: number
  topPaths?: number
} = {}): Promise<ClusterChangePointReport> {
  const kOpt = opts.k ?? 8
  const threshold = opts.threshold ?? 0.3
  const topPoints = opts.topPoints ?? 5
  const maxIterations = opts.maxIterations ?? 20
  const topPathsN = opts.topPaths ?? 3

  const snapshotOpts = {
    k: kOpt,
    maxIterations,
    edgeThreshold: 0.3,
    topPaths: topPathsN,
    topKeywords: 5,
    useEnhancedLabels: false,
    enhancedKeywordsN: 5,
  }

  const { rawDb } = getActiveSession()

  // Find the timestamp range
  const rangeRow = rawDb.prepare(`SELECT MIN(timestamp) AS minTs, MAX(timestamp) AS maxTs FROM commits`)
    .get() as { minTs: number | null; maxTs: number | null }

  if (rangeRow.minTs === null || rangeRow.maxTs === null) {
    return { type: 'cluster-change-points', k: kOpt, threshold, range: { since: '', until: '' }, points: [] }
  }

  const since = opts.since !== undefined ? Math.max(opts.since, rangeRow.minTs) : rangeRow.minTs
  const until = opts.until !== undefined ? Math.min(opts.until, rangeRow.maxTs) : rangeRow.maxTs

  const sinceLabel = new Date(since * 1000).toISOString().slice(0, 10)
  const untilLabel = new Date(until * 1000).toISOString().slice(0, 10)

  // Retrieve all distinct commit timestamps in the range, ordered ascending
  const allTimestamps = (rawDb.prepare(`
    SELECT DISTINCT timestamp FROM commits WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC
  `).all(since, until) as Array<{ timestamp: number }>).map((r) => r.timestamp)

  if (allTimestamps.length < 2) {
    return { type: 'cluster-change-points', k: kOpt, threshold, range: { since: sinceLabel, until: untilLabel }, points: [] }
  }

  // If maxCommits is set, sample evenly across the timeline
  let timestamps = allTimestamps
  if (opts.maxCommits !== undefined && opts.maxCommits > 0 && allTimestamps.length > opts.maxCommits) {
    const sampled: number[] = []
    const step = (allTimestamps.length - 1) / (opts.maxCommits - 1)
    for (let i = 0; i < opts.maxCommits; i++) {
      sampled.push(allTimestamps[Math.round(i * step)])
    }
    // Ensure uniqueness and order
    timestamps = [...new Set(sampled)].sort((a, b) => a - b)
  }

  // Process timestamps and collect change points
  let prevSnapshot: ClusterSnapshot | null = null
  let prevTs: number | null = null
  let prevBlobSet: string = ''

  const allChangePoints: ClusterChangePoint[] = []

  for (const ts of timestamps) {
    const blobHashes = getBlobHashesUpTo(ts)
    // Skip if the visible blob set hasn't changed (saves unnecessary k-means runs)
    const blobSetKey = blobHashes.slice().sort().join(',')
    if (blobSetKey === prevBlobSet && prevSnapshot !== null) {
      prevTs = ts
      continue
    }
    prevBlobSet = blobSetKey

    const snapshot = await computeClusterSnapshot({ ...snapshotOpts, blobHashFilter: blobHashes })

    if (prevSnapshot !== null && prevTs !== null && snapshot.report.clusters.length > 0 && prevSnapshot.report.clusters.length > 0) {
      const prevClusters = prevSnapshot.report.clusters
      const currClusters = snapshot.report.clusters

      // Greedy centroid matching (current → previous)
      const usedPrev = new Set<number>()
      const pairs: Array<{ prev: ClusterInfo; curr: ClusterInfo; drift: number }> = []

      for (const curr of currClusters) {
        let bestPrev: ClusterInfo | null = null
        let bestSim = -Infinity
        for (const prev of prevClusters) {
          if (usedPrev.has(prev.id)) continue
          const sim = cosineSimilarity(prev.centroid, curr.centroid)
          if (sim > bestSim) { bestSim = sim; bestPrev = prev }
        }
        if (bestPrev !== null) {
          usedPrev.add(bestPrev.id)
          pairs.push({ prev: bestPrev, curr, drift: 1 - bestSim })
        }
      }

      if (pairs.length > 0) {
        const shiftScore = pairs.reduce((s, p) => s + p.drift, 0) / pairs.length

        if (shiftScore >= threshold) {
          const topMovingPairs = pairs
            .sort((a, b) => b.drift - a.drift)
            .slice(0, 5)
            .map((p) => ({ beforeLabel: p.prev.label, afterLabel: p.curr.label, drift: p.drift }))

          allChangePoints.push({
            before: {
              ref: new Date(prevTs * 1000).toISOString().slice(0, 10),
              timestamp: prevTs,
              clusters: prevClusters.map((c) => ({ label: c.label, size: c.size, representativePaths: c.representativePaths })),
            },
            after: {
              ref: new Date(ts * 1000).toISOString().slice(0, 10),
              timestamp: ts,
              clusters: currClusters.map((c) => ({ label: c.label, size: c.size, representativePaths: c.representativePaths })),
            },
            shiftScore,
            topMovingPairs,
          })
        }
      }
    }

    prevSnapshot = snapshot
    prevTs = ts
  }

  allChangePoints.sort((a, b) => b.shiftScore - a.shiftScore)
  return {
    type: 'cluster-change-points',
    k: kOpt,
    threshold,
    range: { since: sinceLabel, until: untilLabel },
    points: allChangePoints.slice(0, topPoints),
  }
}
