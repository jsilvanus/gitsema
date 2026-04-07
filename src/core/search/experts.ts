import { getActiveSession } from '../db/sqlite.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A cluster/concept that a contributor worked on.
 */
export interface ExpertCluster {
  clusterId: number
  /** Human-readable cluster label derived from representative paths or keywords. */
  label: string
  /** Number of distinct blobs this author contributed to this cluster. */
  blobCount: number
  /** Top representative file paths from the cluster (up to 3). */
  representativePaths: string[]
}

/**
 * A single contributor ranked by the number of distinct blobs they introduced
 * (within an optional time window).
 */
export interface Expert {
  /** Git author name. */
  authorName: string
  /** Git author e-mail. */
  authorEmail: string
  /** Number of distinct blobs this author contributed (within time window). */
  blobCount: number
  /** Clusters / concepts this author worked on, sorted by blobCount desc. */
  clusters: ExpertCluster[]
}

export interface ComputeExpertsOptions {
  /** Return at most this many experts. Default 10. */
  topN?: number
  /** Only consider commits at or after this Unix timestamp (seconds). */
  since?: number
  /** Only consider commits before or at this Unix timestamp (seconds). */
  until?: number
  /** Suppress authors with fewer than this many blobs. Default 1. */
  minBlobs?: number
  /** How many top clusters to show per expert. Default 5. */
  topClusters?: number
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Returns a ranked list of contributors and the semantic clusters/concepts
 * they worked on, using data already in the index (no embedding required).
 *
 * Algorithm:
 *   1. Join blob_commits → commits (with optional time filter) and count
 *      distinct blobs per (author_name, author_email).
 *   2. Take the top-N authors by blob count.
 *   3. For each author, join their blobs → cluster_assignments → blob_clusters
 *      and aggregate per cluster.
 */
export function computeExperts(opts: ComputeExpertsOptions = {}): Expert[] {
  const { topN = 10, since, until, minBlobs = 1, topClusters = 5 } = opts
  const { rawDb } = getActiveSession()

  // ── Step 1: Rank authors by distinct blob count ──────────────────────────
  let whereClause = ''
  const params: (number | string)[] = []

  if (since !== undefined || until !== undefined) {
    const clauses: string[] = []
    if (since !== undefined) {
      clauses.push('c.timestamp >= ?')
      params.push(since)
    }
    if (until !== undefined) {
      clauses.push('c.timestamp <= ?')
      params.push(until)
    }
    whereClause = 'WHERE ' + clauses.join(' AND ')
  }

  const authorRows = rawDb.prepare(`
    SELECT
      c.author_name   AS authorName,
      c.author_email  AS authorEmail,
      COUNT(DISTINCT bc.blob_hash) AS blobCount
    FROM blob_commits bc
    JOIN commits c ON c.commit_hash = bc.commit_hash
    ${whereClause}
    GROUP BY c.author_name, c.author_email
    HAVING COUNT(DISTINCT bc.blob_hash) >= ?
    ORDER BY blobCount DESC
    LIMIT ?
  `).all(...params, minBlobs, topN) as Array<{
    authorName: string | null
    authorEmail: string | null
    blobCount: number
  }>

  if (authorRows.length === 0) return []

  // ── Step 2: For each author fetch cluster attribution ────────────────────
  // Build a lookup table: clusterID → {label, representativePaths}
  // Only query blob_clusters if cluster data exists.
  const clusterLabelMap = new Map<number, { label: string; representativePaths: string[] }>()
  const clusterRows = rawDb.prepare(
    'SELECT id, label, representative_paths FROM blob_clusters',
  ).all() as Array<{ id: number; label: string; representative_paths: string }>
  for (const row of clusterRows) {
    let paths: string[] = []
    try { paths = JSON.parse(row.representative_paths) } catch { /* ignore */ }
    clusterLabelMap.set(row.id, { label: row.label, representativePaths: paths.slice(0, 3) })
  }

  // Build the per-author cluster query. Extract the author filter condition to avoid
  // duplicating it across the two WHERE clause variants.
  const authorFilter = '(c.author_name = ? OR c.author_email = ?)'
  const clusterWhereClause = whereClause
    ? `${whereClause} AND ${authorFilter}`
    : `WHERE ${authorFilter}`

  const authorClusterStmt = rawDb.prepare(`
    SELECT
      ca.cluster_id AS clusterId,
      COUNT(DISTINCT bc.blob_hash) AS blobCount
    FROM blob_commits bc
    JOIN commits c ON c.commit_hash = bc.commit_hash
    JOIN cluster_assignments ca ON ca.blob_hash = bc.blob_hash
    ${clusterWhereClause}
    GROUP BY ca.cluster_id
    ORDER BY blobCount DESC
    LIMIT ?
  `)

  const experts: Expert[] = []

  for (const row of authorRows) {
    const name = row.authorName ?? 'Unknown'
    const email = row.authorEmail ?? ''

    // Params: time filters (if any) + author name/email + topClusters
    const clusterParams: (number | string)[] = [...params, name, email, topClusters]
    const clusterData = authorClusterStmt.all(...clusterParams) as Array<{
      clusterId: number
      blobCount: number
    }>

    const clusters: ExpertCluster[] = clusterData.map((cd) => {
      const meta = clusterLabelMap.get(cd.clusterId)
      return {
        clusterId: cd.clusterId,
        label: meta?.label ?? `cluster-${cd.clusterId}`,
        blobCount: cd.blobCount,
        representativePaths: meta?.representativePaths ?? [],
      }
    })

    experts.push({
      authorName: name,
      authorEmail: email,
      blobCount: row.blobCount,
      clusters,
    })
  }

  return experts
}
