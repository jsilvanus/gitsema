import { spawn } from 'node:child_process'
import { db } from '../db/sqlite.js'
import { embeddings, paths, blobCommits, commits, symbols, symbolEmbeddings } from '../db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import { cosineSimilarity, getBranchBlobHashSet } from './vectorSearch.js'
import { getFirstSeenMap } from './timeSearch.js'
import type { Embedding } from '../models/types.js'

export interface EvolutionEntry {
  blobHash: string
  commitHash: string
  timestamp: number      // Unix epoch seconds
  distFromPrev: number   // cosine distance from previous version (0 on first)
  distFromOrigin: number // cosine distance from the first version
}

/**
 * Deserializes a Float32Array stored as a Buffer.
 */
function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

/**
 * Cosine *distance* in [0, 2]: 0 means identical, 2 means opposite.
 */
function cosineDistance(a: Embedding, b: Embedding): number {
  return 1 - cosineSimilarity(a, b)
}

/**
 * Returns all blob hashes a given file path has ever had, in the order they
 * first appeared in history (earliest commit timestamp first).
 *
 * Each entry includes the earliest commit hash and timestamp for that blob at
 * that path so the caller can build a timeline.
 */
export function getFileHistory(
  filePath: string,
): Array<{ blobHash: string; commitHash: string; timestamp: number }> {
  // 1. Find all blob hashes associated with this path
  const pathRows = db
    .select({ blobHash: paths.blobHash })
    .from(paths)
    .where(eq(paths.path, filePath))
    .all()

  if (pathRows.length === 0) return []

  const blobHashes = [...new Set(pathRows.map((r) => r.blobHash))]

  // 2. For each blob hash, find the earliest commit it appears in (for this path)
  const BATCH = 500
  const blobTimestamps = new Map<string, { commitHash: string; timestamp: number }>()

  for (let i = 0; i < blobHashes.length; i += BATCH) {
    const batch = blobHashes.slice(i, i + BATCH)
    const rows = db
      .select({
        blobHash: blobCommits.blobHash,
        commitHash: commits.commitHash,
        timestamp: commits.timestamp,
      })
      .from(blobCommits)
      .innerJoin(commits, eq(blobCommits.commitHash, commits.commitHash))
      .where(inArray(blobCommits.blobHash, batch))
      .all()

    for (const row of rows) {
      const existing = blobTimestamps.get(row.blobHash)
      if (!existing || row.timestamp < existing.timestamp) {
        blobTimestamps.set(row.blobHash, {
          commitHash: row.commitHash,
          timestamp: row.timestamp,
        })
      }
    }
  }

  // 3. Build timeline sorted by earliest appearance
  const timeline = blobHashes
    .map((blobHash) => {
      const info = blobTimestamps.get(blobHash)
      return info ? { blobHash, ...info } : null
    })
    .filter((x): x is { blobHash: string; commitHash: string; timestamp: number } => x !== null)
    .sort((a, b) => a.timestamp - b.timestamp)

  return timeline
}

/**
 * Computes the semantic evolution timeline for a file path.
 *
 * For each unique blob the file has ever been, retrieves its stored embedding
 * and computes:
 * - `distFromPrev`: cosine distance from the immediately preceding version
 * - `distFromOrigin`: cosine distance from the very first version
 *
 * Blobs without a stored embedding are silently skipped.
 * Returns entries sorted oldest-first.
 */
export function computeEvolution(filePath: string, originBlob?: string, opts: { useSymbolLevel?: boolean } = {}): EvolutionEntry[] {
  const history = getFileHistory(filePath)
  if (history.length === 0) return []

  const blobHashes = history.map((h) => h.blobHash)

  // Load embeddings for all relevant blobs
  const BATCH = 500
  const embMap = new Map<string, Embedding>()

  if (opts.useSymbolLevel) {
    // Symbol-level: compute centroid of per-symbol embeddings for each blob
    for (let i = 0; i < blobHashes.length; i += BATCH) {
      const batch = blobHashes.slice(i, i + BATCH)
      const rows = db
        .select({ blobHash: symbols.blobHash, vector: symbolEmbeddings.vector })
        .from(symbolEmbeddings)
        .innerJoin(symbols, eq(symbolEmbeddings.symbolId, symbols.id))
        .where(inArray(symbols.blobHash, batch))
        .all()

      // Group by blobHash and compute centroid
      const grouped = new Map<string, Float32Array[]>()
      for (const row of rows) {
        const vec = bufferToEmbedding(row.vector as Buffer)
        const list = grouped.get(row.blobHash) ?? []
        list.push(vec)
        grouped.set(row.blobHash, list)
      }
      for (const [blobHash, vecs] of grouped) {
        const dim = vecs[0].length
        const centroid = new Float32Array(dim)
        for (const v of vecs) for (let d = 0; d < dim; d++) centroid[d] += v[d]
        for (let d = 0; d < dim; d++) centroid[d] /= vecs.length
        embMap.set(blobHash, centroid)
      }
    }
  } else {
    for (let i = 0; i < blobHashes.length; i += BATCH) {
      const batch = blobHashes.slice(i, i + BATCH)
      const rows = db
        .select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
        .from(embeddings)
        .where(inArray(embeddings.blobHash, batch))
        .all()

      for (const row of rows) {
        embMap.set(row.blobHash, bufferToEmbedding(row.vector as Buffer))
      }
    }
  }

  // Build evolution entries
  const result: EvolutionEntry[] = []
  let originEmbedding: Embedding | null = null
  let prevEmbedding: Embedding | null = null

  for (const entry of history) {
    const emb = embMap.get(entry.blobHash)
    if (!emb) continue   // no embedding — skip this version

    // If an origin blob is specified, prefer its embedding as the origin.
    if (originBlob && originEmbedding === null) {
      // Exact match first
      if (embMap.has(originBlob)) {
        originEmbedding = embMap.get(originBlob)!
      } else {
        // Try prefix match for short hashes
        const match = Array.from(embMap.keys()).find((k) => k.startsWith(originBlob))
        if (match) originEmbedding = embMap.get(match)!
      }
    }

    // Fallback: if no origin chosen yet, use the first available embedding
    if (originEmbedding === null) {
      originEmbedding = emb
    }

    const distFromPrev = prevEmbedding !== null ? cosineDistance(prevEmbedding, emb) : 0
    const distFromOrigin = cosineDistance(originEmbedding, emb)

    result.push({
      blobHash: entry.blobHash,
      commitHash: entry.commitHash,
      timestamp: entry.timestamp,
      distFromPrev,
      distFromOrigin,
    })

    prevEmbedding = emb
  }

  return result
}

/**
 * Retrieves the author of a commit as a human-readable string.
 * Returns null if the commit hash is not valid or git is unavailable.
 */
export function getCommitAuthor(commitHash: string, repoPath = '.'): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['log', '-1', '--format=%an <%ae>', commitHash], {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.on('close', (code) => {
      if (code !== 0) resolve(null)
      else resolve(stdout.trim() || null)
    })
    proc.on('error', () => resolve(null))
  })
}

/**
 * Returns the URL of the `origin` remote, or null if unavailable.
 */
export function getRemoteUrl(repoPath = '.'): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['remote', 'get-url', 'origin'], {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.on('close', (code) => {
      if (code !== 0) resolve(null)
      else resolve(stdout.trim() || null)
    })
    proc.on('error', () => resolve(null))
  })
}

/**
 * Constructs a web commit URL from a remote URL and a commit hash.
 *
 * Supports GitHub, GitLab, and Bitbucket HTTPS and SSH remote formats:
 *   - `https://github.com/org/repo.git`   → `https://github.com/org/repo/commit/<hash>`
 *   - `git@github.com:org/repo.git`        → `https://github.com/org/repo/commit/<hash>`
 *   - `https://gitlab.com/org/repo.git`    → `https://gitlab.com/org/repo/-/commit/<hash>`
 *   - `https://bitbucket.org/org/repo.git` → `https://bitbucket.org/org/repo/commits/<hash>`
 *
 * Returns `undefined` for unrecognised remote formats.
 */
export function buildCommitUrl(commitHash: string, remoteUrl: string): string | undefined {
  // Normalise SSH → HTTPS: git@github.com:org/repo.git → https://github.com/org/repo.git
  // Using greedy `.+` so multi-segment paths like org/team/repo are captured in full.
  let url = remoteUrl.trim()
  const sshMatch = url.match(/^git@([^:]+):(.+)$/)
  if (sshMatch) {
    const host = sshMatch[1]
    const path = sshMatch[2].replace(/\.git$/, '')
    url = `https://${host}/${path}`
  } else {
    url = url.replace(/\.git$/, '')
  }

  // Parse the normalised URL and match on the *hostname* only, not a substring of
  // the full URL (which could be trivially spoofed with a path like /github.com/).
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  const { hostname } = parsed
  if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
    return `${url}/commit/${commitHash}`
  }
  if (hostname === 'gitlab.com' || hostname.endsWith('.gitlab.com')) {
    return `${url}/-/commit/${commitHash}`
  }
  if (hostname === 'bitbucket.org' || hostname.endsWith('.bitbucket.org')) {
    return `${url}/commits/${commitHash}`
  }
  return undefined
}

/**
 * Uses `git rev-parse <ref>:<path>` to resolve the blob hash for a file at a
 * specific Git ref.  Returns null if the file does not exist at that ref.
 */
export async function resolveBlobAtRef(ref: string, filePath: string, repoPath = '.'): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', `${ref}:${filePath}`], {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.on('close', (code) => {
      if (code !== 0) resolve(null)
      else resolve(stdout.trim() || null)
    })
    proc.on('error', () => resolve(null))
  })
}

export interface DiffResult {
  ref1: string
  ref2: string
  blobHash1: string | null
  blobHash2: string | null
  cosineDistance: number | null
  /** Nearest neighbours of version 1 */
  neighbors1?: Array<{ blobHash: string; paths: string[]; distance: number }>
  /** Nearest neighbours of version 2 */
  neighbors2?: Array<{ blobHash: string; paths: string[]; distance: number }>
}

/**
 * Computes a semantic diff between two versions of a file identified by Git refs.
 * Optionally returns the nearest neighbours of each version to characterise what
 * each is "about" semantically.
 */
export async function computeDiff(
  ref1: string,
  ref2: string,
  filePath: string,
  opts: { neighbors?: number; repoPath?: string } = {},
): Promise<DiffResult> {
  const { neighbors = 0, repoPath = '.' } = opts

  const [hash1, hash2] = await Promise.all([
    resolveBlobAtRef(ref1, filePath, repoPath),
    resolveBlobAtRef(ref2, filePath, repoPath),
  ])

  const result: DiffResult = {
    ref1,
    ref2,
    blobHash1: hash1,
    blobHash2: hash2,
    cosineDistance: null,
  }

  if (!hash1 || !hash2) return result

  // Load embeddings for both blobs
  const rows = db
    .select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
    .from(embeddings)
    .where(inArray(embeddings.blobHash, [hash1, hash2]))
    .all()

  const embByHash = new Map<string, Embedding>()
  for (const row of rows) {
    embByHash.set(row.blobHash, bufferToEmbedding(row.vector as Buffer))
  }

  const emb1 = embByHash.get(hash1)
  const emb2 = embByHash.get(hash2)

  if (!emb1 || !emb2) return result

  result.cosineDistance = cosineDistance(emb1, emb2)

  if (neighbors > 0) {
    result.neighbors1 = await findNeighbors(hash1, emb1, neighbors)
    result.neighbors2 = await findNeighbors(hash2, emb2, neighbors)
  }

  return result
}

/**
 * Finds the `k` nearest stored blobs to the given embedding, excluding the
 * source blob itself.
 */
async function findNeighbors(
  excludeHash: string,
  queryEmb: Embedding,
  k: number,
): Promise<Array<{ blobHash: string; paths: string[]; distance: number }>> {
  const allRows = db
    .select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
    .from(embeddings)
    .all()

  const scored = allRows
    .filter((r) => r.blobHash !== excludeHash)
    .map((r) => ({
      blobHash: r.blobHash,
      distance: cosineDistance(queryEmb, bufferToEmbedding(r.vector as Buffer)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k)

  if (scored.length === 0) return []

  const hashes = scored.map((s) => s.blobHash)
  const pathRows = db
    .select({ blobHash: paths.blobHash, path: paths.path })
    .from(paths)
    .where(inArray(paths.blobHash, hashes))
    .all()

  const pathsByBlob = new Map<string, string[]>()
  for (const row of pathRows) {
    const list = pathsByBlob.get(row.blobHash) ?? []
    list.push(row.path)
    pathsByBlob.set(row.blobHash, list)
  }

  return scored.map((s) => ({
    blobHash: s.blobHash,
    paths: pathsByBlob.get(s.blobHash) ?? [],
    distance: s.distance,
  }))
}

// ---------------------------------------------------------------------------
// Concept evolution
// ---------------------------------------------------------------------------

export interface ConceptEvolutionEntry {
  blobHash: string
  commitHash: string
  timestamp: number
  paths: string[]
  /** Cosine similarity between this blob and the query (higher = more relevant). */
  score: number
  /** Cosine distance from the previous entry in the timeline (0 for the first). */
  distFromPrev: number
}

/**
 * Semantic concept evolution: searches for all blobs that match a query
 * embedding, sorts them by their earliest commit timestamp, and computes
 * the cosine distance between consecutive entries so you can see how
 * code related to a given concept evolved over the repository's history.
 *
 * @param queryEmbedding - Embedding vector for the concept query
 * @param topK           - How many top-matching blobs to include (default 50)
 * @returns Array of entries sorted oldest-first
 */
export function computeConceptEvolution(
  queryEmbedding: Embedding,
  topK = 50,
  branch?: string,
): ConceptEvolutionEntry[] {
  // 1. Load all stored embeddings and score against the query
  let allRows = db
    .select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
    .from(embeddings)
    .all()

  if (allRows.length === 0) return []

  // Apply branch filter when requested
  if (branch) {
    const branchSet = getBranchBlobHashSet(branch)
    allRows = allRows.filter((r) => branchSet.has(r.blobHash))
    if (allRows.length === 0) return []
  }

  const scored = allRows
    .map((r) => {
      const emb = bufferToEmbedding(r.vector as Buffer)
      return {
        blobHash: r.blobHash,
        emb,
        score: cosineSimilarity(queryEmbedding, emb),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  if (scored.length === 0) return []

  const topHashes = scored.map((s) => s.blobHash)
  const embByHash = new Map<string, { emb: Embedding; score: number }>(scored.map((s) => [s.blobHash, { emb: s.emb, score: s.score }]))

  // 2. Resolve earliest commit for each blob
  const firstSeenMap = getFirstSeenMap(topHashes)

  // 3. Resolve file paths for each blob
  const BATCH = 500
  const pathsByBlob = new Map<string, string[]>()
  for (let i = 0; i < topHashes.length; i += BATCH) {
    const batch = topHashes.slice(i, i + BATCH)
    const pathRows = db
      .select({ blobHash: paths.blobHash, path: paths.path })
      .from(paths)
      .where(inArray(paths.blobHash, batch))
      .all()
    for (const row of pathRows) {
      const list = pathsByBlob.get(row.blobHash) ?? []
      list.push(row.path)
      pathsByBlob.set(row.blobHash, list)
    }
  }

  // 4. Build timeline sorted by earliest commit timestamp
  const timeline = topHashes
    .map((blobHash) => {
      const info = firstSeenMap.get(blobHash)
      if (!info) return null
      const embInfo = embByHash.get(blobHash)!
      return {
        blobHash,
        commitHash: info.commitHash,
        timestamp: info.timestamp,
        paths: pathsByBlob.get(blobHash) ?? [],
        score: embInfo.score,
        emb: embInfo.emb,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.timestamp - b.timestamp)

  // 5. Compute distFromPrev between consecutive timeline entries
  const result: ConceptEvolutionEntry[] = []
  let prevEmb: Embedding | null = null

  for (const entry of timeline) {
    const distFromPrev = prevEmb !== null ? cosineDistance(prevEmb, entry.emb) : 0
    result.push({
      blobHash: entry.blobHash,
      commitHash: entry.commitHash,
      timestamp: entry.timestamp,
      paths: entry.paths,
      score: entry.score,
      distFromPrev,
    })
    prevEmb = entry.emb
  }

  return result
}

