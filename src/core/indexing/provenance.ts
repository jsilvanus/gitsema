import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

export interface EmbedConfig {
  provider: string
  model: string
  codeModel?: string
  dimensions: number
  chunker: string
  windowSize?: number
  overlap?: number
}

export interface StoredEmbedConfig extends EmbedConfig {
  configHash: string
  createdAt: number
}

export interface CompatibilityResult {
  compatible: boolean
  reason?: string
  existingConfigs: StoredEmbedConfig[]
}

/**
 * Compute a deterministic SHA-256 hex hash of the embed configuration.
 * Keys are sorted alphabetically before hashing for stability.
 */
export function computeConfigHash(config: EmbedConfig): string {
  const obj: Record<string, unknown> = {
    chunker: config.chunker,
    codeModel: config.codeModel ?? null,
    dimensions: config.dimensions,
    model: config.model,
    overlap: config.overlap ?? null,
    provider: config.provider,
    windowSize: config.windowSize ?? null,
  }
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

/**
 * Upsert an embed config row into the database. Returns the config hash.
 */
export function saveEmbedConfig(rawDb: InstanceType<typeof Database>, config: EmbedConfig): string {
  const configHash = computeConfigHash(config)
  rawDb.prepare(`
    INSERT OR IGNORE INTO embed_config
      (config_hash, provider, model, code_model, dimensions, chunker, window_size, overlap, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    configHash,
    config.provider,
    config.model,
    config.codeModel ?? null,
    config.dimensions,
    config.chunker,
    config.windowSize ?? null,
    config.overlap ?? null,
    Math.floor(Date.now() / 1000),
  )
  return configHash
}

/**
 * Load all stored embed configs from the database.
 */
export function loadEmbedConfigs(rawDb: InstanceType<typeof Database>): StoredEmbedConfig[] {
  // Table may not exist on older DBs before migration
  const tables = rawDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='embed_config'`).all() as Array<{ name: string }>
  if (tables.length === 0) return []

  return (rawDb.prepare(`SELECT * FROM embed_config ORDER BY created_at ASC`).all() as Array<{
    config_hash: string; provider: string; model: string; code_model: string | null
    dimensions: number; chunker: string; window_size: number | null; overlap: number | null; created_at: number
  }>).map((r) => ({
    configHash: r.config_hash,
    provider: r.provider,
    model: r.model,
    codeModel: r.code_model ?? undefined,
    dimensions: r.dimensions,
    chunker: r.chunker,
    windowSize: r.window_size ?? undefined,
    overlap: r.overlap ?? undefined,
    createdAt: r.created_at,
  }))
}

/**
 * Check if the current embed config is compatible with existing index entries.
 * Incompatibility is declared when any existing config uses a different embedding
 * dimension (mixing dimensions makes cosine similarity meaningless).
 */
export function checkConfigCompatibility(
  rawDb: InstanceType<typeof Database>,
  currentConfig: EmbedConfig,
): CompatibilityResult {
  const existing = loadEmbedConfigs(rawDb)
  if (existing.length === 0) return { compatible: true, existingConfigs: [] }

  const differentDim = existing.find((c) => c.dimensions !== currentConfig.dimensions)
  if (differentDim) {
    return {
      compatible: false,
      reason: `Existing index has embeddings with ${differentDim.dimensions} dimensions (model: ${differentDim.model}), but current config uses ${currentConfig.dimensions} dimensions (model: ${currentConfig.model}). Mixing dimensions corrupts search results. Use --allow-mixed to override, or run: gitsema clear-model ${differentDim.model}`,
      existingConfigs: existing,
    }
  }

  return { compatible: true, existingConfigs: existing }
}
