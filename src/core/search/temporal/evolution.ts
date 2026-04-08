import { spawn } from 'node:child_process'
import { db } from '../../db/sqlite.js'
import { embeddings, paths, blobCommits, commits, symbols, symbolEmbeddings } from '../../db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import { cosineSimilarity, getBranchBlobHashSet } from '../core/vectorSearch.js'
import { getFirstSeenMap } from './timeSearch.js'
import type { Embedding } from '../../models/types.js'

export interface EvolutionEntry {
  blobHash: string
  commitHash: string
  timestamp: number
  distFromPrev: number
  distFromOrigin: number
}

function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

function cosineDistance(a: Embedding, b: Embedding): number {
  return 1 - cosineSimilarity(a, b)
}

export function getFileHistory(filePath: string) {
  const pathRows = db
    .select({ blobHash: paths.blobHash })
    .from(paths)
    .where(eq(paths.path, filePath))
    .all()

  if (pathRows.length === 0) return []

  const blobHashes = [...new Set(pathRows.map((r) => r.blobHash))]

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

  const timeline = blobHashes
    .map((blobHash) => {
      const info = blobTimestamps.get(blobHash)
      return info ? { blobHash, ...info } : null
    })
    .filter((x): x is { blobHash: string; commitHash: string; timestamp: number } => x !== null)
    .sort((a, b) => a.timestamp - b.timestamp)

  return timeline
}

export function computeEvolution(filePath: string, originBlob?: string, opts: { useSymbolLevel?: boolean } = {}): EvolutionEntry[] {
  const history = getFileHistory(filePath)
  if (history.length === 0) return []

  const blobHashes = history.map((h) => h.blobHash)

  const BATCH = 500
  const embMap = new Map<string, Embedding>()

  if (opts.useSymbolLevel) {
    for (let i = 0; i < blobHashes.length; i += BATCH) {
      const batch = blobHashes.slice(i, i + BATCH)
      const rows = db
        .select({ blobHash: symbols.blobHash, vector: symbolEmbeddings.vector })
        .from(symbolEmbeddings)
        .innerJoin(symbols, eq(symbolEmbeddings.symbolId, symbols.id))
        .where(inArray(symbols.blobHash, batch))
        .all()

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

  const result: EvolutionEntry[] = []
  let originEmbedding: Embedding | null = null
  let prevEmbedding: Embedding | null = null

  for (const entry of history) {
    const emb = embMap.get(entry.blobHash)
    if (!emb) continue

    if (originBlob && originEmbedding === null) {
      if (embMap.has(originBlob)) {
        originEmbedding = embMap.get(originBlob)!
      } else {
        const match = Array.from(embMap.keys()).find((k) => k.startsWith(originBlob))
        if (match) originEmbedding = embMap.get(match)!
      }
    }

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

export function buildCommitUrl(commitHash: string, remoteUrl: string): string | undefined {
  let url = remoteUrl.trim()
  const sshMatch = url.match(/^git@([^:]+):(.+)$/)
  if (sshMatch) {
    const host = sshMatch[1]
    const path = sshMatch[2].replace(/\.git$/, '')
    url = `https://${host}/${path}`
  } else {
    url = url.replace(/\.git$/, '')
  }

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
  neighbors1?: Array<{ blobHash: string; paths: string[]; distance: number }>
  neighbors2?: Array<{ blobHash: string; paths: string[]; distance: number }>
}

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

export interface ConceptEvolutionEntry {
  blobHash: string
  commitHash: string
  timestamp: number
  paths: string[]
  score: number
  distFromPrev: number
}

export function computeConceptEvolution(
  queryEmbedding: Embedding,
  topK = 50,
  branch?: string,
  candidateHashes?: string[],
): ConceptEvolutionEntry[] {
  let allRows = db
    .select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
    .from(embeddings)
    .all()

  if (allRows.length === 0) return []

  if (branch) {
    const branchSet = getBranchBlobHashSet(branch)
    allRows = allRows.filter((r) => branchSet.has(r.blobHash))
    if (allRows.length === 0) return []
  }

  if (candidateHashes && candidateHashes.length > 0) {
    const candSet = new Set(candidateHashes)
    allRows = allRows.filter((r) => candSet.has(r.blobHash))
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

  const firstSeenMap = getFirstSeenMap(topHashes)

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

export function extractAlerts(timeline: EvolutionEntry[], threshold: number, top: number) {
  type AlertEntry = { rank: number; date: string; blobHash: string; commitHash?: string; distFromPrev: number; distFromOrigin: number; author?: string }
  const candidates = timeline.filter((t) => t.distFromPrev >= threshold)
  candidates.sort((a, b) => b.distFromPrev - a.distFromPrev || b.distFromOrigin - a.distFromOrigin)
  const selected = candidates.slice(0, top)
  const alerts: AlertEntry[] = []
  let rank = 1
  for (const s of selected) {
    alerts.push({ rank: rank++, date: new Date(s.timestamp * 1000).toISOString(), blobHash: s.blobHash, commitHash: s.commitHash, distFromPrev: s.distFromPrev, distFromOrigin: s.distFromOrigin })
  }
  return alerts
}
