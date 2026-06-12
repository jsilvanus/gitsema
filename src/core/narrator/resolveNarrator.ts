/**
 * Narrator model config — DB-backed storage and retrieval.
 *
 * Narrator configs share the `embed_config` table with embedding configs,
 * distinguished by `kind = 'narrator'`.
 *
 * Active narrator selection is stored in the `settings` table under the key
 * `active_narrator_model_config_id` (integer embed_config.id).
 */

import type Database from 'better-sqlite3'
import type { NarratorModelConfig, NarratorModelParams } from './types.js'
import { createHash } from 'node:crypto'
import { createChattydeerProvider, createDisabledProvider } from './chattydeerProvider.js'
import type { ChattydeerNarratorProvider } from './chattydeerProvider.js'
import { getActiveSession } from '../db/sqlite.js'

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export function getSetting(rawDb: InstanceType<typeof Database>, key: string): string | null {
  const row = rawDb.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(rawDb: InstanceType<typeof Database>, key: string, value: string): void {
  rawDb.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value)
}

export function deleteSetting(rawDb: InstanceType<typeof Database>, key: string): void {
  rawDb.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
}

// ---------------------------------------------------------------------------
// Narrator config rows
// ---------------------------------------------------------------------------

interface NarratorRow {
  id: number
  config_hash: string
  provider: string
  model: string
  params_json: string | null
  created_at: number
  last_used_at: number | null
}

function rowToConfig(row: NarratorRow): NarratorModelConfig {
  let params: NarratorModelParams = { httpUrl: '' }
  if (row.params_json) {
    try {
      params = JSON.parse(row.params_json) as NarratorModelParams
    } catch {
      // malformed JSON — leave default
    }
  }
  return {
    id: row.id,
    name: row.model,
    provider: row.provider,
    params,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? undefined,
  }
}

/**
 * List all narrator model configs in the DB.
 */
export function listNarratorConfigs(rawDb: InstanceType<typeof Database>): NarratorModelConfig[] {
  const tables = rawDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='embed_config'`).all() as Array<{ name: string }>
  if (tables.length === 0) return []
  const rows = rawDb.prepare(`SELECT id, config_hash, provider, model, params_json, created_at, last_used_at FROM embed_config WHERE kind = 'narrator' ORDER BY created_at ASC`).all() as NarratorRow[]
  return rows.map(rowToConfig)
}

/**
 * Get a narrator config by its embed_config.id.
 */
export function getNarratorConfigById(rawDb: InstanceType<typeof Database>, id: number): NarratorModelConfig | null {
  const row = rawDb.prepare(`SELECT id, config_hash, provider, model, params_json, created_at, last_used_at FROM embed_config WHERE id = ? AND kind = 'narrator'`).get(id) as NarratorRow | undefined
  return row ? rowToConfig(row) : null
}

/**
 * Get a narrator config by model name.
 */
export function getNarratorConfigByName(rawDb: InstanceType<typeof Database>, name: string): NarratorModelConfig | null {
  const row = rawDb.prepare(`SELECT id, config_hash, provider, model, params_json, created_at, last_used_at FROM embed_config WHERE model = ? AND kind = 'narrator'`).get(name) as NarratorRow | undefined
  return row ? rowToConfig(row) : null
}

/**
 * Save a narrator model config to the DB. Returns the embed_config.id.
 */
export function saveNarratorConfig(
  rawDb: InstanceType<typeof Database>,
  name: string,
  provider: string,
  params: NarratorModelParams,
): number {
  // config_hash is a deterministic hash of (kind, name, provider, params)
  const hashInput = JSON.stringify({ kind: 'narrator', name, provider, params })
  const configHash = createHash('sha256').update(hashInput).digest('hex')
  const now = Math.floor(Date.now() / 1000)
  const paramsJson = JSON.stringify(params)

  rawDb.prepare(`
    INSERT OR IGNORE INTO embed_config
      (config_hash, provider, model, code_model, dimensions, chunker, window_size, overlap, created_at, kind, params_json)
    VALUES (?, ?, ?, NULL, 0, 'none', NULL, NULL, ?, 'narrator', ?)
  `).run(configHash, provider, name, now, paramsJson)

  // Update params_json on re-add (params may have changed)
  rawDb.prepare(`UPDATE embed_config SET params_json = ?, last_used_at = ? WHERE config_hash = ?`)
    .run(paramsJson, now, configHash)

  const row = rawDb.prepare(`SELECT id FROM embed_config WHERE config_hash = ?`).get(configHash) as { id: number }
  return row.id
}

/**
 * Delete a narrator config by name.
 * Returns true if a row was deleted.
 */
export function deleteNarratorConfig(rawDb: InstanceType<typeof Database>, name: string): boolean {
  const res = rawDb.prepare(`DELETE FROM embed_config WHERE model = ? AND kind = 'narrator'`).run(name)
  return res.changes > 0
}

// ---------------------------------------------------------------------------
// Active narrator selection
// ---------------------------------------------------------------------------

const ACTIVE_NARRATOR_KEY = 'active_narrator_model_config_id'

/**
 * Get the currently active narrator config ID, or null if not set.
 */
export function getActiveNarratorConfigId(rawDb: InstanceType<typeof Database>): number | null {
  const val = getSetting(rawDb, ACTIVE_NARRATOR_KEY)
  if (val === null) return null
  const n = parseInt(val, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Set the active narrator config by embed_config.id.
 */
export function setActiveNarratorConfig(rawDb: InstanceType<typeof Database>, id: number): void {
  setSetting(rawDb, ACTIVE_NARRATOR_KEY, String(id))
}

/**
 * Clear the active narrator config selection.
 */
export function clearActiveNarratorConfig(rawDb: InstanceType<typeof Database>): void {
  deleteSetting(rawDb, ACTIVE_NARRATOR_KEY)
}

/**
 * Get the currently active narrator config object, or null if not set / not found.
 */
export function getActiveNarratorConfig(rawDb: InstanceType<typeof Database>): NarratorModelConfig | null {
  const id = getActiveNarratorConfigId(rawDb)
  if (id === null) return null
  return getNarratorConfigById(rawDb, id)
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the active NarratorProvider from the DB session.
 *
 * Resolution order:
 *   1. `narratorModelId` CLI option (explicit embed_config.id)
 *   2. `modelName` CLI option (looks up by name)
 *   3. Active narrator config from settings table
 *   4. Disabled (safe-by-default)
 */
export function resolveNarratorProvider(opts: {
  narratorModelId?: number
  modelName?: string
} = {}): ChattydeerNarratorProvider {
  const { rawDb } = getActiveSession()

  let config: NarratorModelConfig | null = null

  if (opts.narratorModelId !== undefined) {
    config = getNarratorConfigById(rawDb, opts.narratorModelId)
  } else if (opts.modelName) {
    config = getNarratorConfigByName(rawDb, opts.modelName)
  } else {
    config = getActiveNarratorConfig(rawDb)
  }

  if (!config) {
    return createDisabledProvider()
  }

  return createChattydeerProvider(config.name, config.params)
}

// ---------------------------------------------------------------------------
// Guide model config (kind='guide') — same infrastructure as narrator
// ---------------------------------------------------------------------------

const ACTIVE_GUIDE_KEY = 'active_guide_model_config_id'

/** List all guide model configs (kind='guide'). */
export function listGuideConfigs(rawDb: InstanceType<typeof Database>): NarratorModelConfig[] {
  const tables = rawDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='embed_config'`).all() as Array<{ name: string }>
  if (tables.length === 0) return []
  const rows = rawDb.prepare(`SELECT id, config_hash, provider, model, params_json, created_at, last_used_at FROM embed_config WHERE kind = 'guide' ORDER BY created_at ASC`).all() as NarratorRow[]
  return rows.map(rowToConfig)
}

/** Get the active guide config ID from settings. */
export function getActiveGuideConfigId(rawDb: InstanceType<typeof Database>): number | null {
  const val = getSetting(rawDb, ACTIVE_GUIDE_KEY)
  if (val === null) return null
  const n = parseInt(val, 10)
  return Number.isFinite(n) ? n : null
}

/** Get the active guide config object. */
export function getActiveGuideConfig(rawDb: InstanceType<typeof Database>): NarratorModelConfig | null {
  const id = getActiveGuideConfigId(rawDb)
  if (id === null) return null
  return getNarratorConfigById(rawDb, id)
}

/** Set the active guide config by embed_config.id. */
export function setActiveGuideConfig(rawDb: InstanceType<typeof Database>, id: number): void {
  setSetting(rawDb, ACTIVE_GUIDE_KEY, String(id))
}

/** Clear the active guide config selection. */
export function clearActiveGuideConfig(rawDb: InstanceType<typeof Database>): void {
  deleteSetting(rawDb, ACTIVE_GUIDE_KEY)
}

/** Get a guide config by name. */
export function getGuideConfigByName(rawDb: InstanceType<typeof Database>, name: string): NarratorModelConfig | null {
  const row = rawDb.prepare(`SELECT id, config_hash, provider, model, params_json, created_at, last_used_at FROM embed_config WHERE model = ? AND kind = 'guide'`).get(name) as NarratorRow | undefined
  return row ? rowToConfig(row) : null
}

/** Save a guide model config. Returns embed_config.id. */
export function saveGuideConfig(
  rawDb: InstanceType<typeof Database>,
  name: string,
  provider: string,
  params: NarratorModelParams,
): number {
  const hashInput = JSON.stringify({ kind: 'guide', name, provider, params })
  const configHash = createHash('sha256').update(hashInput).digest('hex')
  const now = Math.floor(Date.now() / 1000)
  const paramsJson = JSON.stringify(params)

  rawDb.prepare(`
    INSERT OR IGNORE INTO embed_config
      (config_hash, provider, model, code_model, dimensions, chunker, window_size, overlap, created_at, kind, params_json)
    VALUES (?, ?, ?, NULL, 0, 'none', NULL, NULL, ?, 'guide', ?)
  `).run(configHash, provider, name, now, paramsJson)

  rawDb.prepare(`UPDATE embed_config SET params_json = ?, last_used_at = ? WHERE config_hash = ?`)
    .run(paramsJson, now, configHash)

  const row = rawDb.prepare(`SELECT id FROM embed_config WHERE config_hash = ?`).get(configHash) as { id: number }
  return row.id
}

/** Delete a guide config by name. Returns true if deleted. */
export function deleteGuideConfig(rawDb: InstanceType<typeof Database>, name: string): boolean {
  const res = rawDb.prepare(`DELETE FROM embed_config WHERE model = ? AND kind = 'guide'`).run(name)
  return res.changes > 0
}

/** Resolve the active guide NarratorProvider from the DB. Falls back to narrator config, then disabled. */
export function resolveGuideProvider(opts: {
  guideModelId?: number
  modelName?: string
} = {}): ChattydeerNarratorProvider {
  const { rawDb } = getActiveSession()

  let config: NarratorModelConfig | null = null

  if (opts.guideModelId !== undefined) {
    config = getNarratorConfigById(rawDb, opts.guideModelId)
  } else if (opts.modelName) {
    config = getGuideConfigByName(rawDb, opts.modelName) ?? getNarratorConfigByName(rawDb, opts.modelName)
  } else {
    // Prefer guide config; fall back to narrator config
    config = getActiveGuideConfig(rawDb) ?? getActiveNarratorConfig(rawDb)
  }

  if (!config) {
    return createDisabledProvider()
  }

  return createChattydeerProvider(config.name, config.params)
}
