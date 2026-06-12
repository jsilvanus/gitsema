import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 11,
  description: 'Add quantization columns to embedding tables',
  up(sqlite: InstanceType<typeof Database>) {
    const embCols = sqlite.prepare('PRAGMA table_info(embeddings)').all() as Array<{ name: string }>
    if (!embCols.some((c) => c.name === 'quantized')) {
      sqlite.exec(`ALTER TABLE embeddings ADD COLUMN quantized INTEGER DEFAULT 0`)
      sqlite.exec(`ALTER TABLE embeddings ADD COLUMN quant_min REAL`)
      sqlite.exec(`ALTER TABLE embeddings ADD COLUMN quant_scale REAL`)
    }
    const chunkCols = sqlite.prepare('PRAGMA table_info(chunk_embeddings)').all() as Array<{ name: string }>
    if (!chunkCols.some((c) => c.name === 'quantized')) {
      sqlite.exec(`ALTER TABLE chunk_embeddings ADD COLUMN quantized INTEGER DEFAULT 0`)
      sqlite.exec(`ALTER TABLE chunk_embeddings ADD COLUMN quant_min REAL`)
      sqlite.exec(`ALTER TABLE chunk_embeddings ADD COLUMN quant_scale REAL`)
    }
    const symCols = sqlite.prepare('PRAGMA table_info(symbol_embeddings)').all() as Array<{ name: string }>
    if (!symCols.some((c) => c.name === 'quantized')) {
      sqlite.exec(`ALTER TABLE symbol_embeddings ADD COLUMN quantized INTEGER DEFAULT 0`)
      sqlite.exec(`ALTER TABLE symbol_embeddings ADD COLUMN quant_min REAL`)
      sqlite.exec(`ALTER TABLE symbol_embeddings ADD COLUMN quant_scale REAL`)
    }
    const commitEmbCols = sqlite.prepare('PRAGMA table_info(commit_embeddings)').all() as Array<{ name: string }>
    if (!commitEmbCols.some((c) => c.name === 'quantized')) {
      sqlite.exec(`ALTER TABLE commit_embeddings ADD COLUMN quantized INTEGER DEFAULT 0`)
      sqlite.exec(`ALTER TABLE commit_embeddings ADD COLUMN quant_min REAL`)
      sqlite.exec(`ALTER TABLE commit_embeddings ADD COLUMN quant_scale REAL`)
    }
  },
}
