import { getActiveSession } from '../../core/db/sqlite.js'
import { dequantizeVector, deserializeQuantized } from '../../core/embedding/quantize.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface BuildVssOptions {
  model?: string
  quantize?: boolean
  efConstruction?: string
  M?: string
}

const DB_DIR = '.gitsema'

/**
 * Builds a usearch HNSW ANN index from stored embeddings for the given model.
 *
 * Reads all embeddings (or all quantized embeddings when --quantize is set)
 * for the given model from SQLite, builds an HNSW index using usearch, and
 * writes the index to `.gitsema/vectors-<model>.usearch` and a hash map to
 * `.gitsema/vectors-<model>.map.json`.
 */
export async function buildVssCommand(options: BuildVssOptions = {}): Promise<void> {
  // Dynamic import so usearch is optional — if not installed we give a helpful error.
  let usearch: typeof import('usearch') | null = null
  try {
    usearch = await import('usearch')
  } catch {
    console.error(
      'Error: the `usearch` package is required for the build-vss command.\n' +
      'Install it with: npm install usearch  (or pnpm add usearch)',
    )
    process.exit(1)
  }

  const providerModel = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const model = options.model ?? providerModel

  const efConstruction = options.efConstruction !== undefined ? parseInt(options.efConstruction, 10) : 200
  const M = options.M !== undefined ? parseInt(options.M, 10) : 16

  const { rawDb } = getActiveSession()

  // Load all embeddings for the given model
  const rows = rawDb.prepare(
    `SELECT blob_hash, vector, quantized, quant_min, quant_scale
     FROM embeddings WHERE model = ?`,
  ).all(model) as Array<{
    blob_hash: string
    vector: Buffer
    quantized: number
    quant_min: number | null
    quant_scale: number | null
  }>

  if (rows.length === 0) {
    console.error(`No embeddings found for model '${model}'. Run \`gitsema index\` first.`)
    process.exit(1)
  }

  console.log(`Building VSS index for model '${model}' from ${rows.length} embeddings...`)

  // Decode first vector to determine dimensions
  const firstRow = rows[0]
  let firstVec: Float32Array
  if (firstRow.quantized === 1 && firstRow.quant_min != null && firstRow.quant_scale != null) {
    firstVec = dequantizeVector(deserializeQuantized(firstRow.vector, firstRow.quant_min, firstRow.quant_scale))
  } else {
    firstVec = new Float32Array(firstRow.vector.buffer, firstRow.vector.byteOffset, firstRow.vector.byteLength / 4)
  }
  const dimensions = firstVec.length

  // Build usearch index
  // Use the Index class (usearch's main export)
  const Index = (usearch as any).Index ?? (usearch as any).default?.Index
  if (!Index) {
    console.error('Error: could not find Index class in usearch package. Check your usearch version.')
    process.exit(1)
  }
  const index = new Index({ metric: 'cos', connectivity: M, expansion_add: efConstruction, dimensions })

  // Map from numeric ID to blob hash (we use sequential integer IDs)
  const idToHash: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    let vec: Float32Array
    if (row.quantized === 1 && row.quant_min != null && row.quant_scale != null) {
      vec = dequantizeVector(deserializeQuantized(row.vector, row.quant_min, row.quant_scale))
    } else {
      vec = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4)
    }
    // Optionally re-quantize to float32 before adding (usearch supports float32)
    index.add(i, vec)
    idToHash.push(row.blob_hash)
  }

  mkdirSync(DB_DIR, { recursive: true })

  // Save the index and hash map
  const safeName = model.replace(/[^a-zA-Z0-9._-]/g, '_')
  const indexPath = join(DB_DIR, `vectors-${safeName}.usearch`)
  const mapPath = join(DB_DIR, `vectors-${safeName}.map.json`)

  index.save(indexPath)
  writeFileSync(mapPath, JSON.stringify(idToHash), 'utf8')

  console.log(`VSS index built: ${indexPath}`)
  console.log(`  Blobs indexed: ${rows.length}`)
  console.log(`  Dimensions:    ${dimensions}`)
  console.log(`  HNSW M:        ${M}`)
  console.log(`  ef_construction: ${efConstruction}`)
  console.log(`Hash map saved:  ${mapPath}`)
}
