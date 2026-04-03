/**
 * gitsema configuration manager
 *
 * Supports two configuration scopes:
 *   - global: ~/.config/gitsema/config.json  (user-level persistent defaults)
 *   - local:  .gitsema/config.json           (repo-level persistent defaults)
 *
 * Precedence (highest → lowest):
 *   Environment Variables > Local Config > Global Config > Hard-coded Defaults
 *
 * Keys use dot-notation for nested sections, e.g. "search.hybrid" or "index.concurrency".
 * Top-level keys (e.g. "provider") correspond directly to environment variables.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfigScope = 'global' | 'local'

/** A flat map of dot-notation keys to their string (or JSON-serialisable) values. */
export type ConfigData = Record<string, unknown>

export interface ConfigEntry {
  key: string
  value: unknown
  source: 'env' | 'local' | 'global' | 'default'
}

// ---------------------------------------------------------------------------
// Key → environment-variable mapping
// ---------------------------------------------------------------------------

/**
 * Top-level config keys that map directly to environment variables.
 * When an env var is set it takes precedence over any config file entry.
 */
export const ENV_KEY_MAP: Record<string, string> = {
  provider:     'GITSEMA_PROVIDER',
  model:        'GITSEMA_MODEL',
  textModel:    'GITSEMA_TEXT_MODEL',
  codeModel:    'GITSEMA_CODE_MODEL',
  httpUrl:      'GITSEMA_HTTP_URL',
  apiKey:       'GITSEMA_API_KEY',
  verbose:      'GITSEMA_VERBOSE',
  logMaxBytes:  'GITSEMA_LOG_MAX_BYTES',
  servePort:    'GITSEMA_SERVE_PORT',
  serveKey:     'GITSEMA_SERVE_KEY',
  remoteUrl:    'GITSEMA_REMOTE',
  remoteKey:    'GITSEMA_REMOTE_KEY',
}

/**
 * All recognised config keys, grouped by section.
 * Sections are stored under their prefix in the JSON file.
 */
export const ALL_KEYS: ReadonlyArray<string> = [
  // Provider / embedding
  'provider',
  'model',
  'textModel',
  'codeModel',
  'httpUrl',
  'apiKey',
  // Logging / infra
  'verbose',
  'logMaxBytes',
  // Server
  'servePort',
  'serveKey',
  // Remote
  'remoteUrl',
  'remoteKey',
  // index command defaults
  'index.concurrency',
  'index.maxCommits',
  'index.ext',
  'index.maxSize',
  'index.exclude',
  'index.chunker',
  'index.windowSize',
  'index.overlap',
  // search command defaults
  'search.top',
  'search.hybrid',
  'search.bm25Weight',
  'search.weightVector',
  'search.weightRecency',
  'search.weightPath',
  'search.recent',
  // evolution command defaults
  'evolution.threshold',
  // cluster command defaults
  'clusters.k',
]

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the path to the global config file:
 *   ~/.config/gitsema/config.json
 */
export function getGlobalConfigPath(): string {
  return join(homedir(), '.config', 'gitsema', 'config.json')
}

/**
 * Returns the path to the local (repo) config file relative to `cwd`:
 *   <cwd>/.gitsema/config.json
 */
export function getLocalConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, '.gitsema', 'config.json')
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/** Reads and parses a JSON config file. Returns an empty object if absent. */
export function loadConfigFile(filePath: string): ConfigData {
  if (!existsSync(filePath)) return {}
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ConfigData
    }
    return {}
  } catch {
    return {}
  }
}

/** Writes `data` to `filePath` as formatted JSON. Creates directories as needed. */
export function saveConfigFile(filePath: string, data: ConfigData): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// Deep get / set / unset helpers for nested dot-notation keys
// ---------------------------------------------------------------------------

/**
 * Keys that must never be written to guard against prototype pollution.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Validates that no part of a dot-notation key is a forbidden prototype key.
 * Throws if a dangerous key segment is detected.
 */
function assertSafeKey(key: string): void {
  for (const part of key.split('.')) {
    if (FORBIDDEN_KEYS.has(part)) {
      throw new Error(`Invalid config key segment: '${part}'`)
    }
  }
}

/**
 * Gets a value from a nested object using dot-notation.
 * e.g. getDeep({ search: { top: 10 } }, 'search.top') → 10
 */
export function getDeep(obj: ConfigData, key: string): unknown {
  assertSafeKey(key)
  const parts = key.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}

/**
 * Sets a value in a nested object using dot-notation (mutates `obj`).
 * Creates intermediate objects as needed.
 */
export function setDeep(obj: ConfigData, key: string, value: unknown): void {
  assertSafeKey(key)
  const parts = key.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === null || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part]
  }
  current[parts[parts.length - 1]] = value
}

/**
 * Removes a key from a nested object using dot-notation (mutates `obj`).
 * Returns true if the key existed.
 */
export function unsetDeep(obj: ConfigData, key: string): boolean {
  assertSafeKey(key)
  const parts = key.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === null || typeof current[part] !== 'object') return false
    current = current[part]
  }
  const lastPart = parts[parts.length - 1]
  if (!(lastPart in current)) return false
  delete current[lastPart]
  return true
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/**
 * Coerces a string value coming from the CLI to the most appropriate JS type:
 *   "true" / "false" → boolean
 *   numeric strings → number
 *   everything else → string
 */
export function coerceValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  const n = Number(raw)
  if (!isNaN(n) && raw.trim() !== '') return n
  return raw
}

// ---------------------------------------------------------------------------
// High-level config operations
// ---------------------------------------------------------------------------

/**
 * Returns the resolved value for `key` with full precedence:
 *   ENV > local config > global config > undefined
 *
 * Also returns the source so callers can display it.
 * If the env var was injected by applyConfigToEnv (from a config file),
 * the true config file source is reported instead of 'env'.
 */
export function getConfigValue(
  key: string,
  cwd: string = process.cwd(),
): { value: unknown; source: ConfigEntry['source'] } {
  // 1. Environment variable (only for top-level keys that have a mapping).
  //    Only treat as 'env' source if the var was set by the user's shell,
  //    not injected by applyConfigToEnv.
  const envVar = ENV_KEY_MAP[key]
  if (envVar !== undefined) {
    const envVal = process.env[envVar]
    if (envVal !== undefined && !injectedEnvVars.has(envVar)) {
      return { value: envVal, source: 'env' }
    }
  }

  // 2. Local config
  const local = loadConfigFile(getLocalConfigPath(cwd))
  const localVal = getDeep(local, key)
  if (localVal !== undefined) return { value: localVal, source: 'local' }

  // 3. Global config
  const global = loadConfigFile(getGlobalConfigPath())
  const globalVal = getDeep(global, key)
  if (globalVal !== undefined) return { value: globalVal, source: 'global' }

  return { value: undefined, source: 'default' }
}

/**
 * Sets `key` to `value` in the chosen scope's config file.
 */
export function setConfigValue(
  key: string,
  value: unknown,
  scope: ConfigScope,
  cwd: string = process.cwd(),
): void {
  const filePath = scope === 'global' ? getGlobalConfigPath() : getLocalConfigPath(cwd)
  const data = loadConfigFile(filePath)
  setDeep(data, key, value)
  saveConfigFile(filePath, data)
}

/**
 * Removes `key` from the chosen scope's config file.
 * Returns true if the key existed.
 */
export function unsetConfigValue(
  key: string,
  scope: ConfigScope,
  cwd: string = process.cwd(),
): boolean {
  const filePath = scope === 'global' ? getGlobalConfigPath() : getLocalConfigPath(cwd)
  const data = loadConfigFile(filePath)
  const existed = unsetDeep(data, key)
  if (existed) saveConfigFile(filePath, data)
  return existed
}

/**
 * Tracks which env vars were injected by applyConfigToEnv (i.e., set from
 * config files, not set by the user's shell environment).  listConfig uses
 * this to report the true source rather than 'env'.
 */
const injectedEnvVars = new Set<string>()

/**
 * Lists all known config keys with their resolved values and sources.
 * Keys without a value in any source are still included (source = 'default').
 *
 * Note: if an env var was set by applyConfigToEnv from a config file, the
 * source is reported as 'local' or 'global' — not 'env' — so the listing
 * reflects where the value actually lives.
 */
export function listConfig(cwd: string = process.cwd()): ConfigEntry[] {
  const local = loadConfigFile(getLocalConfigPath(cwd))
  const global = loadConfigFile(getGlobalConfigPath())

  // Collect all keys that appear in any source (env, local, or global)
  const keySet = new Set<string>(ALL_KEYS)

  // Also add any extra keys found in the actual config files
  function collectKeys(obj: ConfigData, prefix: string): void {
    for (const k of Object.keys(obj)) {
      const full = prefix ? `${prefix}.${k}` : k
      const val = obj[k]
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        collectKeys(val as ConfigData, full)
      } else {
        keySet.add(full)
      }
    }
  }
  collectKeys(local, '')
  collectKeys(global, '')

  return Array.from(keySet).sort().map((key) => {
    const envVar = ENV_KEY_MAP[key]
    if (envVar !== undefined) {
      const envVal = process.env[envVar]
      // Only treat as 'env' source if it was set by the user's shell, not by
      // applyConfigToEnv (which injects values from config files).
      if (envVal !== undefined && !injectedEnvVars.has(envVar)) {
        return { key, value: envVal, source: 'env' as const }
      }
    }
    const localVal = getDeep(local, key)
    if (localVal !== undefined) return { key, value: localVal, source: 'local' as const }
    const globalVal = getDeep(global, key)
    if (globalVal !== undefined) return { key, value: globalVal, source: 'global' as const }
    return { key, value: undefined, source: 'default' as const }
  })
}

/**
 * Applies all config file values to `process.env` so that commands that read
 * env vars directly pick up file-based defaults.
 *
 * Only sets env vars that are NOT already set (env always wins).
 * This should be called once at startup in the CLI entry point.
 */
export function applyConfigToEnv(cwd: string = process.cwd()): void {
  const local = loadConfigFile(getLocalConfigPath(cwd))
  const global = loadConfigFile(getGlobalConfigPath())

  for (const [key, envVar] of Object.entries(ENV_KEY_MAP)) {
    if (process.env[envVar] !== undefined) continue // env wins

    const localVal = getDeep(local, key)
    if (localVal !== undefined) {
      process.env[envVar] = String(localVal)
      injectedEnvVars.add(envVar)
      continue
    }

    const globalVal = getDeep(global, key)
    if (globalVal !== undefined) {
      process.env[envVar] = String(globalVal)
      injectedEnvVars.add(envVar)
    }
  }
}
