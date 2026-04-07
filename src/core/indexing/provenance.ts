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
 * Also updates `last_used_at` to the current timestamp on each call.
 */
export function saveEmbedConfig(rawDb: InstanceType<typeof Database>, config: EmbedConfig): string {
  const configHash = computeConfigHash(config)
  const now = Math.floor(Date.now() / 1000)
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
    now,
  )
  // Update last_used_at on every successful call (column may not exist on old DBs — guard with try)
  try {
    rawDb.prepare(`UPDATE embed_config SET last_used_at = ? WHERE config_hash = ?`).run(now, configHash)
  } catch {
    // last_used_at column not yet present — harmless, migration will add it on next open
  }
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
 *
 * Because gitsema supports multi-model DBs (each model's embeddings are stored
 * under a composite (blob_hash, model) primary key), different models with
 * different dimensions can coexist and are expected.
 *
 * Incompatibility is only declared when the **same model name** appears in the
 * stored configs with a different embedding dimension — which would mean the
 * model was somehow re-embedded with a different output size, corrupting cosine
 * comparisons within that model's result set.
 */
export function checkConfigCompatibility(
  rawDb: InstanceType<typeof Database>,
  currentConfig: EmbedConfig,
): CompatibilityResult {
  const existing = loadEmbedConfigs(rawDb)
  if (existing.length === 0) return { compatible: true, existingConfigs: [] }

  // Only check configs that used the same model name(s) as the current run
  const modelsInUse = [currentConfig.model, ...(currentConfig.codeModel ? [currentConfig.codeModel] : [])]
  const conflicting = existing.find(
    (c) => modelsInUse.includes(c.model) && c.dimensions !== currentConfig.dimensions,
  )
  if (conflicting) {
    return {
      compatible: false,
      reason: `Model "${conflicting.model}" was previously indexed with ${conflicting.dimensions} dimensions, but the current run produces ${currentConfig.dimensions} dimensions. This would corrupt cosine comparisons for that model. Use --allow-mixed to override, or run: gitsema clear-model ${conflicting.model}`,
      existingConfigs: existing,
    }
  }

  return { compatible: true, existingConfigs: existing }
}
