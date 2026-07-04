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
import type { ByokCredentials, NarratorModelConfig, NarratorModelParams, NarratorProvider } from './types.js'
import { isCliParams } from './types.js'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { createChattydeerProvider, createDisabledProvider } from './chattydeerProvider.js'
import { createCliProvider } from './cliProvider.js'
import { getActiveSession } from '../db/sqlite.js'

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export class ByokUrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ByokUrlValidationError'
  }
}

function getAllowlistedByokHosts(): string[] {
  return (process.env.GITSEMA_BYOK_ALLOW_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isBlockedIPv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return false
  const [first, second] = octets
  if (first === 127) return true
  if (first === 0) return true
  if (first === 10) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  return false
}

function isBlockedIPv6(address: string): boolean {
  if (address === '::1') return true
  if (address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb')) return true
  if (address.startsWith('fc') || address.startsWith('fd')) return true
  return false
}

function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) return isBlockedIPv4(address)
  if (isIP(address) === 6) return isBlockedIPv6(address)
  return false
}

function isIPv4CidrMatch(address: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split('/')
  if (!network || !prefixText) return false
  const prefix = Number.parseInt(prefixText, 10)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const octets = address.split('.').map((part) => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return false
  const networkOctets = network.split('.').map((part) => Number.parseInt(part, 10))
  if (networkOctets.length !== 4 || networkOctets.some((part) => Number.isNaN(part))) return false
  const ipValue = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  const networkValue = ((networkOctets[0] << 24) | (networkOctets[1] << 16) | (networkOctets[2] << 8) | networkOctets[3]) >>> 0
  if (prefix === 0) return true
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0)
  return (ipValue & mask) === (networkValue & mask)
}

function isAllowlistedHost(hostname: string, allowlist: string[]): boolean {
  const normalizedHost = hostname.toLowerCase()
  return allowlist.some((entry) => {
    const normalizedEntry = entry.toLowerCase()
    if (!normalizedEntry) return false
    if (normalizedEntry === normalizedHost) return true
    if (isIP(normalizedHost) === 4 && normalizedEntry.includes('/')) {
      return isIPv4CidrMatch(normalizedHost, normalizedEntry)
    }
    return false
  })
}

async function validateByokUrl(byokUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(byokUrl)
  } catch {
    throw new ByokUrlValidationError(`Invalid BYOK URL: ${byokUrl}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ByokUrlValidationError(`BYOK URL must use http or https: ${byokUrl}`)
  }

  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.includes('metadata')) {
    throw new ByokUrlValidationError(`BYOK URL resolves to a blocked host: ${host}`)
  }

  const allowlist = getAllowlistedByokHosts()
  if (allowlist.length > 0 && isAllowlistedHost(host, allowlist)) return

  const ipVersion = isIP(host)
  if (ipVersion === 4 || ipVersion === 6) {
    const address = host
    if (isBlockedAddress(address)) {
      throw new ByokUrlValidationError(`BYOK URL resolves to a blocked address: ${address}`)
    }
    return
  }

  try {
    const resolved = await lookup(host, { all: true })
    const blocked = resolved.some(({ address }) => isBlockedAddress(address))
    if (blocked) {
      throw new ByokUrlValidationError(`BYOK URL resolves to a blocked host: ${host}`)
    }
  } catch (err) {
    if (err instanceof ByokUrlValidationError) throw err
    // Ignore DNS failures — the URL may still be valid but temporarily unresolved.
  }
}

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
 * Build a NarratorProvider for a resolved config, dispatching on
 * `config.provider` / the shape of `config.params`:
 *   - `provider === 'cli'` (and CLI params) → CliNarratorProvider
 *   - HTTP params with `httpUrl` set      → ChattydeerNarratorProvider
 *   - otherwise (no config, or disabled)   → disabled placeholder provider
 */
/**
 * Builds a one-off, never-persisted `NarratorModelConfig` from request-scoped
 * BYOK credentials (Phase 130 / locked-model-set-plan.md §5 Phase 3). `id: -1`
 * is a sentinel — this config is never written to or read from `embed_config`.
 */
export async function byokConfig(byok: ByokCredentials): Promise<NarratorModelConfig> {
  await validateByokUrl(byok.httpUrl)
  return {
    id: -1,
    name: byok.model ?? 'byok',
    provider: 'chattydeer',
    params: {
      httpUrl: byok.httpUrl,
      ...(byok.apiKey ? { apiKey: byok.apiKey } : {}),
      ...(byok.model ? { model: byok.model } : {}),
      ...(byok.maxTokens !== undefined ? { maxTokens: byok.maxTokens } : {}),
      ...(byok.temperature !== undefined ? { temperature: byok.temperature } : {}),
    },
    createdAt: Math.floor(Date.now() / 1000),
  }
}

export function createNarratorProviderFor(config: NarratorModelConfig | null): NarratorProvider {
  if (!config) {
    return createDisabledProvider()
  }
  if (config.provider === 'cli' && isCliParams(config.params)) {
    return createCliProvider(config.name, config.params)
  }
  if (!isCliParams(config.params) && config.params.httpUrl) {
    return createChattydeerProvider(config.name, config.params)
  }
  return createDisabledProvider()
}

/**
 * Resolve the active NarratorProvider from the DB session.
 *
 * Resolution order:
 *   0. `byok` request-scoped credentials (Phase 130) — one-off provider,
 *      bypasses the DB entirely (no allow-list check, no persistence)
 *   1. `narratorModelId` CLI option (explicit embed_config.id)
 *   2. `modelName` CLI option (looks up by name)
 *   3. Active narrator config from settings table
 *   4. Disabled (safe-by-default)
 */
export async function resolveNarratorProvider(opts: {
  narratorModelId?: number
  modelName?: string
  byok?: ByokCredentials
} = {}): Promise<NarratorProvider> {
  if (opts.byok) {
    const config = await byokConfig(opts.byok)
    return createNarratorProviderFor(config)
  }

  const { rawDb } = getActiveSession()

  let config: NarratorModelConfig | null = null

  if (opts.narratorModelId !== undefined) {
    config = getNarratorConfigById(rawDb, opts.narratorModelId)
  } else if (opts.modelName) {
    config = getNarratorConfigByName(rawDb, opts.modelName)
  } else {
    config = getActiveNarratorConfig(rawDb)
  }

  return createNarratorProviderFor(config)
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

/** Get a guide config by its embed_config.id. */
export function getGuideConfigById(rawDb: InstanceType<typeof Database>, id: number): NarratorModelConfig | null {
  const row = rawDb.prepare(`SELECT id, config_hash, provider, model, params_json, created_at, last_used_at FROM embed_config WHERE id = ? AND kind = 'guide'`).get(id) as NarratorRow | undefined
  return row ? rowToConfig(row) : null
}

/** Get the active guide config object. */
export function getActiveGuideConfig(rawDb: InstanceType<typeof Database>): NarratorModelConfig | null {
  const id = getActiveGuideConfigId(rawDb)
  if (id === null) return null
  return getGuideConfigById(rawDb, id)
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

/**
 * Resolve the active guide NarratorModelConfig from the DB, without
 * constructing a provider. Falls back to the narrator config, then null
 * (safe-by-default — no model configured).
 *
 * Shared by `resolveGuideProvider` (single-shot narration) and the
 * `gitsema guide` agent loop, which needs raw params (httpUrl/apiKey/model)
 * to construct a `createChatProvider` from `@jsilvanus/chattydeer`.
 */
export async function resolveGuideConfig(opts: {
  guideModelId?: number
  modelName?: string
  byok?: ByokCredentials
} = {}): Promise<NarratorModelConfig | null> {
  if (opts.byok) {
    return await byokConfig(opts.byok)
  }

  const { rawDb } = getActiveSession()

  if (opts.guideModelId !== undefined) {
    return getGuideConfigById(rawDb, opts.guideModelId) ?? getNarratorConfigById(rawDb, opts.guideModelId)
  } else if (opts.modelName) {
    return getGuideConfigByName(rawDb, opts.modelName) ?? getNarratorConfigByName(rawDb, opts.modelName)
  } else {
    // Prefer guide config; fall back to narrator config
    return getActiveGuideConfig(rawDb) ?? getActiveNarratorConfig(rawDb)
  }
}

/** Resolve the active guide NarratorProvider from the DB. Falls back to narrator config, then disabled. */
export async function resolveGuideProvider(opts: {
  guideModelId?: number
  modelName?: string
  byok?: ByokCredentials
} = {}): Promise<NarratorProvider> {
  const config = await resolveGuideConfig(opts)
  return createNarratorProviderFor(config)
}
