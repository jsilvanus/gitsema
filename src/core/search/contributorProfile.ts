import { getActiveSession } from '../db/sqlite.js'
import { commits, blobCommits, embeddings, paths } from '../db/schema.js'
import { inArray } from 'drizzle-orm'
import { cosineSimilarity } from './vectorSearch.js'
import { vectorSearch } from './vectorSearch.js'

export interface ContributorProfileOptions {
  topK?: number
  branch?: string
}

/**
 * Computes a contributor semantic profile by averaging embeddings of blobs
 * touched by commits authored by `author`. Returns the top-K blobs most
 * similar to the contributor centroid (what they specialize in).
 */
export async function computeContributorProfile(author: string, opts: ContributorProfileOptions = {}) {
  const { topK = 10, branch } = opts
  const { db } = getActiveSession()

  // 1. Find commits by author (match name or email case-insensitive, substring)
  const allCommits = db.select({ commitHash: commits.commitHash, authorName: commits.authorName, authorEmail: commits.authorEmail })
    .from(commits)
    .all()
  const targetCommits = allCommits.filter((c: any) => {
    const name = (c.authorName ?? '').toLowerCase()
    const email = (c.authorEmail ?? '').toLowerCase()
    const q = author.toLowerCase()
    return name === q || email === q || name.includes(q) || email.includes(q)
  }).map((c: any) => c.commitHash)

  if (targetCommits.length === 0) return []

  // 2. Gather blobs touched by those commits
  const BATCH = 500
  const blobSet = new Set<string>()
  for (let i = 0; i < targetCommits.length; i += BATCH) {
    const batch = targetCommits.slice(i, i + BATCH)
    const rows = db.select({ blobHash: blobCommits.blobHash })
      .from(blobCommits)
      .where(inArray(blobCommits.commitHash, batch))
      .all()
    for (const r of rows) blobSet.add(r.blobHash)
  }

  const blobHashes = Array.from(blobSet)
  if (blobHashes.length === 0) return []

  // 3. Load embeddings for these blobs and compute centroid
  const vectors: Float32Array[] = []
  for (let i = 0; i < blobHashes.length; i += BATCH) {
    const batch = blobHashes.slice(i, i + BATCH)
    const rows = db.select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
      .from(embeddings)
      .where(inArray(embeddings.blobHash, batch))
      .all()
    for (const r of rows) {
      if (r.vector) vectors.push(new Float32Array((r.vector as Buffer).buffer, (r.vector as Buffer).byteOffset, (r.vector as Buffer).byteLength / 4))
    }
  }

  if (vectors.length === 0) return []

  const dim = vectors[0].length
  const centroid = new Float32Array(dim)
  for (const v of vectors) for (let d = 0; d < dim; d++) centroid[d] += v[d]
  for (let d = 0; d < dim; d++) centroid[d] /= vectors.length

  // 4. Use vectorSearch to find top-K most similar blobs to centroid
  const results = vectorSearch(Array.from(centroid), { topK, branch })
  return results
}
