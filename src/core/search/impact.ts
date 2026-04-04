import { readFileSync, existsSync } from 'node:fs'
import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths, chunks, chunkEmbeddings, symbols, symbolEmbeddings } from '../db/schema.js'
import { inArray, eq } from 'drizzle-orm'
import { cosineSimilarity, getBranchBlobHashSet } from './vectorSearch.js'
import type { EmbeddingProvider } from '../embedding/provider.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single semantically-coupled blob found by impact analysis.
 */
export interface ImpactResult {
  /** SHA-1 hash of the coupled blob. */
  blobHash: string
  /** All file paths this blob is known by. */
  paths: string[]
  /**
   * Cosine similarity to the target blob/chunk, in [0, 1].
   * Higher → more semantically coupled.
   */
  score: number
  /**
   * Directory component of the top-level path (or '.' when no slash).
   * Used to group results by module for cross-module coupling display.
   */
  module: string
  /** 1-indexed start line when this result is a chunk-level match. */
  startLine?: number
  /** 1-indexed end line when this result is a chunk-level match. */
  endLine?: number
}

/**
 * Summary entry for a single cross-module coupling group.
 */
export interface ModuleGroup {
  /** Directory path representing the module, e.g. `"src/auth"`. */
  module: string
  /** Number of coupled blobs/chunks in this module. */
  count: number
  /** Highest coupling score within this module. */
  maxScore: number
  /**
   * Distinct file paths seen in this module group, de-duplicated and sorted
   * by their (descending) score within the group.
   */
  paths: string[]
}

/**
 * Complete report produced by `computeImpact`.
 */
export interface ImpactReport {
  /** File path of the target (as supplied by the caller). */
  targetPath: string
  /**
   * SHA-1 blob hash of the target at HEAD, or `null` when the file is not
   * indexed or could not be embedded.
   */
  targetBlobHash: string | null
  /** Top-K coupled results, sorted by score descending. */
  results: ImpactResult[]
  /** Per-module coupling summary derived from `results`. */
  moduleGroups: ModuleGroup[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deserializes a Float32Array stored as a Buffer back to number[]. */
function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

/**
 * Returns the directory component of a path string, or `'.'` when there is no
 * slash (i.e. the file lives at the repo root).
 */
export function moduleOf(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  return slash >= 0 ? filePath.slice(0, slash) : '.'
}

/**
 * Builds a per-module summary from a list of impact results.
 * Groups by `result.module`, aggregates count / maxScore / paths, then sorts
 * the groups by `maxScore` descending.
 */
export function buildModuleGroups(results: ImpactResult[]): ModuleGroup[] {
  const map = new Map<string, { count: number; maxScore: number; pathSet: Map<string, number> }>()

  for (const r of results) {
    let group = map.get(r.module)
    if (!group) {
      group = { count: 0, maxScore: 0, pathSet: new Map() }
      map.set(r.module, group)
    }
    group.count++
    if (r.score > group.maxScore) group.maxScore = r.score
    for (const p of r.paths) {
      const existing = group.pathSet.get(p)
      if (existing === undefined || r.score > existing) {
        group.pathSet.set(p, r.score)
      }
    }
  }

  const groups: ModuleGroup[] = []
  for (const [module, g] of map) {
    // Sort paths within the group by their best score descending
    const paths = [...g.pathSet.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p)
    groups.push({ module, count: g.count, maxScore: g.maxScore, paths })
  }

  return groups.sort((a, b) => b.maxScore - a.maxScore)
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Computes the refactor impact of a given file.
 *
 * The algorithm:
 *  1. Read the target file from disk (resolved path must exist).
 *  2. Embed the full file content using `provider`.
 *  3. Look up whether the file is already indexed (to surface its blob hash).
 *  4. Score every stored blob embedding (and optionally chunk embeddings) by
 *     cosine similarity to the target embedding.
 *  5. Exclude the target blob itself from the results to avoid self-matches.
 *  6. Return the top-K results plus a cross-module coupling summary.
 *
 * @param filePath   - Path to the target file (relative or absolute; read from disk).
 * @param provider   - Embedding provider to embed the target content.
 * @param opts.topK         - Number of similar blobs to return (default 10).
 * @param opts.searchChunks - When true, include chunk-level embeddings in the
 *                            candidate pool for finer-grained coupling (default false).
 * @param opts.repoPath     - Repository working directory, used to look up
 *                            paths in the index (default '.').
 */
export async function computeImpact(
  filePath: string,
  provider: EmbeddingProvider,
  opts: { topK?: number; searchChunks?: boolean; searchSymbols?: boolean; repoPath?: string; branch?: string } = {},
): Promise<ImpactReport> {
  const { topK = 10, searchChunks = false, searchSymbols = false, branch } = opts
  const { db } = getActiveSession()

  // --- Read and embed target file ---
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (err) {
    throw new Error(`Could not read file: ${err instanceof Error ? err.message : String(err)}`)
  }

  const targetEmbedding = await provider.embed(content)

  // --- Find the target's blob hash in the index (best-effort) ---
  // We look for paths that end with the relative portion of filePath
  const normalised = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const pathRows = db
    .select({ blobHash: paths.blobHash, path: paths.path })
    .from(paths)
    .all()

  let targetBlobHash: string | null = null
  for (const row of pathRows) {
    if (row.path === normalised || row.path.endsWith(`/${normalised}`) || normalised.endsWith(`/${row.path}`)) {
      targetBlobHash = row.blobHash
      break
    }
  }

  // --- Load all candidate embeddings ---
  type CandidateRow = {
    blobHash: string
    vector: Buffer
    chunkId?: number
    startLine?: number
    endLine?: number
    symbolId?: number
    symbolName?: string
    symbolKind?: string
    language?: string
  }

  let allEmbRows: Array<{ blobHash: string; vector: unknown }> = db
    .select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
    .from(embeddings)
    .all()

  // Apply branch filter
  if (branch) {
    const branchSet = getBranchBlobHashSet(branch)
    allEmbRows = allEmbRows.filter((r) => branchSet.has(r.blobHash))
  }

  let candidates: CandidateRow[] = allEmbRows.map((r) => ({
    blobHash: r.blobHash,
    vector: r.vector as Buffer,
  }))

  if (searchChunks) {
    const chunkRows = db
      .select({
        chunkId: chunks.id,
        blobHash: chunks.blobHash,
        startLine: chunks.startLine,
        endLine: chunks.endLine,
        vector: chunkEmbeddings.vector,
      })
      .from(chunkEmbeddings)
      .innerJoin(chunks, eq(chunkEmbeddings.chunkId, chunks.id))
      .all()

    for (const row of chunkRows) {
      candidates.push({
        blobHash: row.blobHash,
        vector: row.vector as Buffer,
        chunkId: row.chunkId,
        startLine: row.startLine,
        endLine: row.endLine,
      })
    }
  }

  if (searchSymbols) {
    const symRows = db
      .select({
        blobHash: symbols.blobHash,
        startLine: symbols.startLine,
        endLine: symbols.endLine,
        symbolId: symbols.id,
        symbolName: symbols.symbolName,
        symbolKind: symbols.symbolKind,
        language: symbols.language,
        vector: symbolEmbeddings.vector,
      })
      .from(symbolEmbeddings)
      .innerJoin(symbols, eq(symbolEmbeddings.symbolId, symbols.id))
      .all()

    for (const row of symRows) {
      candidates.push({
        blobHash: row.blobHash,
        vector: row.vector as Buffer,
        symbolId: row.symbolId,
        symbolName: row.symbolName,
        symbolKind: row.symbolKind,
        language: row.language,
        startLine: row.startLine,
        endLine: row.endLine,
      })
    }
  }

  // Exclude the target blob itself
  if (targetBlobHash) {
    candidates = candidates.filter((c) => c.blobHash !== targetBlobHash)
  }

  if (candidates.length === 0) {
    return { targetPath: filePath, targetBlobHash, results: [], moduleGroups: [] }
  }

  // --- Score all candidates ---
  type ScoredCandidate = CandidateRow & { score: number }
  const scored: ScoredCandidate[] = candidates.map((c) => ({
    ...c,
    score: cosineSimilarity(targetEmbedding, bufferToEmbedding(c.vector)),
  }))

  // Sort descending, deduplicate by blobHash (keep best score per blob unless chunk/symbol-level)
  scored.sort((a, b) => b.score - a.score)

  let topEntries: ScoredCandidate[]
  if (searchChunks || searchSymbols) {
    // When chunk/symbol-level results are requested, keep distinct (blobHash, chunkId/symbolId) pairs
    topEntries = scored.slice(0, topK)
  } else {
    const bestByBlob = new Map<string, ScoredCandidate>()
    for (const entry of scored) {
      const existing = bestByBlob.get(entry.blobHash)
      if (!existing || entry.score > existing.score) {
        bestByBlob.set(entry.blobHash, entry)
      }
    }
    topEntries = Array.from(bestByBlob.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  // --- Resolve file paths for results ---
  const blobHashes = [...new Set(topEntries.map((e) => e.blobHash))]
  const resolvedPaths = db
    .select({ blobHash: paths.blobHash, path: paths.path })
    .from(paths)
    .where(inArray(paths.blobHash, blobHashes))
    .all()

  const pathsByBlob = new Map<string, string[]>()
  for (const row of resolvedPaths) {
    const list = pathsByBlob.get(row.blobHash) ?? []
    list.push(row.path)
    pathsByBlob.set(row.blobHash, list)
  }

  const results: ImpactResult[] = topEntries.map((e) => {
    const blobPaths = pathsByBlob.get(e.blobHash) ?? []
    const topPath = blobPaths[0] ?? ''
    return {
      blobHash: e.blobHash,
      paths: blobPaths,
      score: e.score,
      module: moduleOf(topPath),
      startLine: e.startLine,
      endLine: e.endLine,
    }
  })

  const moduleGroups = buildModuleGroups(results)

  return { targetPath: filePath, targetBlobHash, results, moduleGroups }
}
