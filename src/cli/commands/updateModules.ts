import { dirname } from 'node:path'
import { getAllBlobEmbeddingsWithPaths, storeModuleEmbedding, deleteAllModuleEmbeddings } from '../../core/indexing/blobStore.js'

export async function updateModulesCommand(options: { verbose?: boolean } = {}): Promise<void> {
  const rows = getAllBlobEmbeddingsWithPaths()
  // Group by directory, tracking model per group (use the first seen model per dir)
  const groups = new Map<string, { vecs: number[][]; model: string }>()

  for (const r of rows) {
    const dir = dirname(r.path)
    const existing = groups.get(dir)
    if (existing) {
      existing.vecs.push(r.vector)
    } else {
      groups.set(dir, { vecs: [r.vector], model: r.model })
    }
  }

  // Recompute centroids: simple arithmetic mean
  let updated = 0
  deleteAllModuleEmbeddings()
  for (const [dir, { vecs, model }] of groups) {
    if (vecs.length === 0) continue
    const dim = vecs[0].length
    const mean = new Array<number>(dim).fill(0)
    for (const v of vecs) {
      for (let i = 0; i < dim; i++) mean[i] += v[i]
    }
    for (let i = 0; i < dim; i++) mean[i] = mean[i] / vecs.length
    storeModuleEmbedding({ modulePath: dir, model, embedding: mean, blobCount: vecs.length })
    updated++
  }

  console.log(`Updated ${updated} module embeddings`)
}
