import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths } from '../db/schema.js'
import { inArray } from 'drizzle-orm'
import { cosineSimilarity } from './vectorSearch.js'
import { getFileCategory } from '../embedding/fileType.js'

export interface DocGapOptions {
  topK?: number
  threshold?: number // include only code blobs with max-similarity < threshold
  branch?: string
}

export interface DocGapResult {
  blobHash: string
  paths: string[]
  maxDocSimilarity: number
}

/**
 * Computes documentation gap by finding code blobs with lowest max-similarity
 * to any documentation blob. Returns results sorted ascending by max-similarity
 * (lowest = least documented).
 */
export async function computeDocGap(opts: DocGapOptions = {}): Promise<DocGapResult[]> {
  const { db } = getActiveSession()
  const { topK = 20, threshold, branch } = opts

  // Load all paths so we can classify blobs as code vs doc
  const pathRows = db.select({ blobHash: paths.blobHash, path: paths.path }).from(paths).all()
  const pathsByBlob = new Map<string, string[]>()
  for (const r of pathRows) {
    const list = pathsByBlob.get(r.blobHash) ?? []
    list.push(r.path)
    pathsByBlob.set(r.blobHash, list)
  }

  const allBlobHashes = [...pathsByBlob.keys()]
  if (allBlobHashes.length === 0) return []

  // Partition into code blobs and doc blobs
  const codeBlobs: string[] = []
  const docBlobs: string[] = []
  for (const b of allBlobHashes) {
    const ps = pathsByBlob.get(b) ?? []
    // pick the first path to classify
    const cat = ps.length > 0 ? getFileCategory(ps[0]) : 'other'
    if (cat === 'code') codeBlobs.push(b)
    else if (cat === 'text') docBlobs.push(b)
  }

  if (codeBlobs.length === 0) return []
  if (docBlobs.length === 0) {
    // No documentation blobs indexed — everything is undocumented (max similarity = 0)
    return codeBlobs.slice(0, topK).map((b) => ({ blobHash: b, paths: pathsByBlob.get(b) ?? [], maxDocSimilarity: 0 }))
  }

  // Load embeddings for doc blobs
  const BATCH = 500
  const docEmbeddings: Float32Array[] = []
  for (let i = 0; i < docBlobs.length; i += BATCH) {
    const batch = docBlobs.slice(i, i + BATCH)
    const rows = db.select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
      .from(embeddings)
      .where(inArray(embeddings.blobHash, batch))
      .all()
    for (const row of rows) {
      if (row.vector) docEmbeddings.push(new Float32Array((row.vector as Buffer).buffer, (row.vector as Buffer).byteOffset, (row.vector as Buffer).byteLength / 4))
    }
  }

  if (docEmbeddings.length === 0) {
    return codeBlobs.slice(0, topK).map((b) => ({ blobHash: b, paths: pathsByBlob.get(b) ?? [], maxDocSimilarity: 0 }))
  }

  // For each code blob, find its stored embedding and compute max cosine similarity
  const results: DocGapResult[] = []
  for (let i = 0; i < codeBlobs.length; i += BATCH) {
    const batch = codeBlobs.slice(i, i + BATCH)
    const rows = db.select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
      .from(embeddings)
      .where(inArray(embeddings.blobHash, batch))
      .all()

    for (const row of rows) {
      const emb = new Float32Array((row.vector as Buffer).buffer, (row.vector as Buffer).byteOffset, (row.vector as Buffer).byteLength / 4)
      let maxSim = 0
      for (const d of docEmbeddings) {
        const sim = cosineSimilarity(emb, d)
        if (sim > maxSim) maxSim = sim
      }
      if (threshold !== undefined && maxSim >= threshold) continue
      results.push({ blobHash: row.blobHash, paths: pathsByBlob.get(row.blobHash) ?? [], maxDocSimilarity: maxSim })
    }
  }

  results.sort((a, b) => a.maxDocSimilarity - b.maxDocSimilarity)
  return results.slice(0, topK)
}
