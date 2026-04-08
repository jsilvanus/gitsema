export * from './temporal/evolution.js'
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
  candidateHashes?: string[],
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

  // If candidateHashes is provided, filter to those hashes before scoring
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
