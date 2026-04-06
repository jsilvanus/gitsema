/**
 * gitsema project — compute 2D projections of all embeddings (Phase 55).
 *
 * Uses random projection (a fast, deterministic approximation) to reduce
 * high-dimensional embeddings to 2D coordinates. Stores results in the
 * `projections` table for use by `gitsema serve --ui`.
 *
 * Random projection is not as accurate as UMAP/t-SNE but requires no
 * additional dependencies and runs in O(n*d) time.
 */

import { getRawDb } from '../../core/db/sqlite.js'
import { dequantizeVector, deserializeQuantized } from '../../core/embedding/quantize.js'

interface ProjectionRow {
  blobHash: string
  x: number
  y: number
}

/**
 * Deterministic pseudo-random number generator seeded with a value.
 * Uses a Linear Congruential Generator (Numerical Recipes parameters).
 * Returns values in [-1, 1].
 */
function seededRand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return ((s >>> 0) / 0x100000000) * 2 - 1
  }
}

/**
 * Compute a random projection matrix R with shape [dims, 2].
 * Each column is a unit vector drawn from a seeded PRNG.
 */
function buildProjectionMatrix(dims: number, seed = 42): Float32Array {
  const R = new Float32Array(dims * 2)
  const rand = seededRand(seed)
  for (let j = 0; j < 2; j++) {
    let sumSq = 0
    for (let i = 0; i < dims; i++) {
      const v = rand()
      R[i * 2 + j] = v
      sumSq += v * v
    }
    const norm = Math.sqrt(sumSq)
    for (let i = 0; i < dims; i++) {
      R[i * 2 + j] /= norm
    }
  }
  return R
}

function project(embedding: Float32Array, R: Float32Array): [number, number] {
  let x = 0, y = 0
  for (let i = 0; i < embedding.length; i++) {
    x += embedding[i] * R[i * 2]
    y += embedding[i] * R[i * 2 + 1]
  }
  return [x, y]
}

export async function projectCommand(opts: { model?: string; limit?: string } = {}): Promise<void> {
  const rawDb = getRawDb()
  const model = opts.model ?? process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const limit = opts.limit ? parseInt(opts.limit, 10) : 10000

  const rows = rawDb.prepare(
    `SELECT blob_hash, vector, quantized, quant_min, quant_scale
     FROM embeddings WHERE model = ? LIMIT ?`,
  ).all(model, limit) as Array<{
    blob_hash: string
    vector: Buffer
    quantized: number
    quant_min: number | null
    quant_scale: number | null
  }>

  if (rows.length === 0) {
    console.error(`No embeddings found for model '${model}'. Run 'gitsema index' first.`)
    process.exit(1)
  }

  console.log(`Computing 2D random projection for ${rows.length} embeddings (model: ${model})…`)

  // Decode first vector to determine dimensions
  const firstRow = rows[0]
  let firstVec: Float32Array
  if (firstRow.quantized === 1 && firstRow.quant_min != null && firstRow.quant_scale != null) {
    firstVec = dequantizeVector(deserializeQuantized(firstRow.vector, firstRow.quant_min, firstRow.quant_scale))
  } else {
    firstVec = new Float32Array(firstRow.vector.buffer, firstRow.vector.byteOffset, firstRow.vector.byteLength / 4)
  }
  const dims = firstVec.length

  const R = buildProjectionMatrix(dims)

  const projections: ProjectionRow[] = []
  for (const row of rows) {
    let vec: Float32Array
    if (row.quantized === 1 && row.quant_min != null && row.quant_scale != null) {
      vec = dequantizeVector(deserializeQuantized(row.vector, row.quant_min, row.quant_scale))
    } else {
      vec = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4)
    }
    const [x, y] = project(vec, R)
    projections.push({ blobHash: row.blob_hash, x, y })
  }

  // Normalize to [-1, 1] range
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of projections) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  for (const p of projections) {
    p.x = (p.x - minX) / rangeX * 2 - 1
    p.y = (p.y - minY) / rangeY * 2 - 1
  }

  // Write to projections table
  const now = Math.floor(Date.now() / 1000)
  const insert = rawDb.prepare(
    `INSERT OR REPLACE INTO projections (blob_hash, model, x, y, projected_at) VALUES (?, ?, ?, ?, ?)`,
  )
  const insertMany = rawDb.transaction((rows: ProjectionRow[]) => {
    for (const r of rows) {
      insert.run(r.blobHash, model, r.x, r.y, now)
    }
  })
  insertMany(projections)

  console.log(`Stored ${projections.length} projection points for model '${model}'.`)
  console.log(`Run 'gitsema serve --ui' to visualize.`)
}
