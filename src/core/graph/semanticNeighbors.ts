/**
 * Semantic-similarity helper for the Phase 109 fusion commands
 * (`blast-radius`, `relate`, `similar`): ranks stored embeddings by cosine
 * similarity to a graph node's *own* stored embedding, so these commands need
 * no embedding provider / network call.
 *
 * sqlite-only for now (raw `embeddings`/`symbols`/`symbol_embeddings` queries);
 * other storage backends degrade to an empty (but `supported: false`) result,
 * so hybrid-lens commands fall back to structural-only output gracefully.
 */

import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths, symbols, symbolEmbeddings } from '../db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import { cosineSimilarityPrecomputed, vectorNorm } from '../search/analysis/vectorSearch.js'
import { bufferToFloat32 } from '../../utils/embedding.js'
import { getCachedStorageProfile } from '../storage/resolveProfile.js'
import type { GraphNodeRecord } from '../storage/types.js'

export interface SemanticHit {
  blobHash: string
  paths: string[]
  score: number
  symbolId?: number
  symbolName?: string
  qualifiedName?: string
  startLine?: number
  endLine?: number
}

export interface SemanticNeighborsResult {
  /** False when the active storage backend doesn't support this lookup (non-sqlite). */
  supported: boolean
  hits: SemanticHit[]
}

function pathsByBlob(hashes: string[]): Map<string, string[]> {
  if (hashes.length === 0) return new Map()
  const { db } = getActiveSession()
  const rows = db.select({ blobHash: paths.blobHash, path: paths.path })
    .from(paths)
    .where(inArray(paths.blobHash, hashes))
    .all()
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.blobHash) ?? []
    list.push(row.path)
    map.set(row.blobHash, list)
  }
  return map
}

/**
 * Finds blobs whose whole-file embedding is most similar to `blobHash`'s,
 * excluding `blobHash` itself.
 */
function fileNeighbors(blobHash: string, topK: number): SemanticHit[] {
  const { db } = getActiveSession()
  const target = db.select({ vector: embeddings.vector, model: embeddings.model })
    .from(embeddings)
    .where(eq(embeddings.blobHash, blobHash))
    .limit(1)
    .all()[0]
  if (!target) return []

  const targetVec = bufferToFloat32(target.vector as Buffer)
  const targetNorm = vectorNorm(targetVec)

  const rows = db.select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
    .from(embeddings)
    .where(eq(embeddings.model, target.model))
    .all()

  const scored = rows
    .filter((r) => r.blobHash !== blobHash)
    .map((r) => ({
      blobHash: r.blobHash,
      score: cosineSimilarityPrecomputed(targetVec, targetNorm, bufferToFloat32(r.vector as Buffer)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  const byBlob = pathsByBlob(scored.map((s) => s.blobHash))
  return scored.map((s) => ({ blobHash: s.blobHash, paths: byBlob.get(s.blobHash) ?? [], score: s.score }))
}

/**
 * Finds symbols whose embedding is most similar to the symbol identified by
 * `blobHash` + `qualifiedName` + `signatureHash`, excluding itself.
 */
function symbolNeighbors(blobHash: string, qualifiedName: string, signatureHash: string, topK: number): SemanticHit[] {
  const { db } = getActiveSession()
  const targetRow = db.select({ id: symbols.id, qualifiedName: symbols.qualifiedName, signatureHash: symbols.signatureHash })
    .from(symbols)
    .where(eq(symbols.blobHash, blobHash))
    .all()
    .find((s) => s.qualifiedName === qualifiedName && s.signatureHash === signatureHash)
  if (!targetRow) return []

  const targetEmb = db.select({ vector: symbolEmbeddings.vector, model: symbolEmbeddings.model })
    .from(symbolEmbeddings)
    .where(eq(symbolEmbeddings.symbolId, targetRow.id))
    .limit(1)
    .all()[0]
  if (!targetEmb) return []

  const targetVec = bufferToFloat32(targetEmb.vector as Buffer)
  const targetNorm = vectorNorm(targetVec)

  const rows = db.select({
    symbolId: symbolEmbeddings.symbolId,
    vector: symbolEmbeddings.vector,
    blobHash: symbols.blobHash,
    symbolName: symbols.symbolName,
    qualifiedName: symbols.qualifiedName,
    startLine: symbols.startLine,
    endLine: symbols.endLine,
  })
    .from(symbolEmbeddings)
    .innerJoin(symbols, eq(symbolEmbeddings.symbolId, symbols.id))
    .where(eq(symbolEmbeddings.model, targetEmb.model))
    .all()

  const scored = rows
    .filter((r) => r.symbolId !== targetRow.id)
    .map((r) => ({
      ...r,
      score: cosineSimilarityPrecomputed(targetVec, targetNorm, bufferToFloat32(r.vector as Buffer)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  const byBlob = pathsByBlob(scored.map((s) => s.blobHash))
  return scored.map((s) => ({
    blobHash: s.blobHash,
    paths: byBlob.get(s.blobHash) ?? [],
    score: s.score,
    symbolId: s.symbolId,
    symbolName: s.symbolName,
    qualifiedName: s.qualifiedName ?? undefined,
    startLine: s.startLine,
    endLine: s.endLine,
  }))
}

/** Parses `symbol:<path>#<qualifiedName>#<signatureHash>` into its parts. */
export function parseSymbolNodeKey(nodeKey: string): { path: string; qualifiedName: string; signatureHash: string } | null {
  if (!nodeKey.startsWith('symbol:')) return null
  const rest = nodeKey.slice('symbol:'.length)
  const lastHash = rest.lastIndexOf('#')
  const secondHash = rest.lastIndexOf('#', lastHash - 1)
  if (lastHash === -1 || secondHash === -1) return null
  return {
    path: rest.slice(0, secondHash),
    qualifiedName: rest.slice(secondHash + 1, lastHash),
    signatureHash: rest.slice(lastHash + 1),
  }
}

/**
 * Semantic neighbors of a resolved graph node — file nodes rank by whole-file
 * embedding similarity; symbol nodes rank by symbol-embedding similarity.
 * Returns `{ supported: false, hits: [] }` on non-sqlite backends.
 */
export async function semanticNeighborsForNode(node: GraphNodeRecord, topK = 10): Promise<SemanticNeighborsResult> {
  const profile = getCachedStorageProfile()
  if (profile.backend !== 'sqlite') return { supported: false, hits: [] }
  if (!node.currentBlobHash) return { supported: true, hits: [] }

  if (node.kind === 'file') {
    return { supported: true, hits: fileNeighbors(node.currentBlobHash, topK) }
  }

  const parsed = parseSymbolNodeKey(node.nodeKey)
  if (!parsed) return { supported: true, hits: [] }
  return { supported: true, hits: symbolNeighbors(node.currentBlobHash, parsed.qualifiedName, parsed.signatureHash, topK) }
}
