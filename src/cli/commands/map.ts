import { getActiveSession } from '../../core/db/sqlite.js'

export async function mapCommand(): Promise<void> {
  const { rawDb } = getActiveSession()

  try {
    const clusters = rawDb.prepare('SELECT id, label, centroid, size, representative_paths FROM blob_clusters').all() as Array<any>
    const assignmentsRows = rawDb.prepare('SELECT blob_hash, cluster_id FROM cluster_assignments').all() as Array<any>

    const clusterList = clusters.map((r) => ({
      id: r.id,
      label: r.label,
      centroid: r.centroid ? Array.from(new Float32Array(r.centroid.buffer, r.centroid.byteOffset, r.centroid.byteLength / 4)) : [],
      size: r.size,
      representativePaths: r.representative_paths ? JSON.parse(r.representative_paths) : [],
    }))

    const assignments: Record<string, number> = {}
    for (const a of assignmentsRows) assignments[a.blob_hash] = a.cluster_id

    console.log(JSON.stringify({ clusters: clusterList, assignments }, null, 2))
  } catch (err) {
    console.log(JSON.stringify({ clusters: [], assignments: {} }, null, 2))
  }
}
