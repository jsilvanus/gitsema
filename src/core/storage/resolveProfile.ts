/**
 * Resolves a `StorageProfile` from configuration (Phase 101).
 *
 * Reads the `storage.*` config keys (with the usual env > local > global
 * precedence) and the `project | user | named` scope model to decide which
 * backend and location a command runs against. Only the `sqlite` backend is
 * implemented in Phase 101; `postgres` and `qdrant` resolve to a clear
 * "not yet implemented" error (planned for Phases 102 / 103).
 */

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { getConfigValue } from '../config/configManager.js'
import { getOrOpenSessionAtPath, withDbSession } from '../db/sqlite.js'
import { SqliteStorageProfile } from './sqlite/profile.js'
import type { StorageBackend, StorageProfile, StorageScope } from './types.js'

function readString(key: string, cwd: string): string | undefined {
  const { value } = getConfigValue(key, cwd)
  if (value === undefined || value === null) return undefined
  const s = String(value).trim()
  return s === '' ? undefined : s
}

function resolveBackend(cwd: string): StorageBackend {
  const raw = (readString('storage.backend', cwd) ?? 'sqlite').toLowerCase()
  if (raw === 'sqlite' || raw === 'postgres' || raw === 'qdrant') return raw
  throw new Error(
    `Invalid storage.backend '${raw}' (expected: sqlite | postgres | qdrant)`,
  )
}

function resolveScope(cwd: string): StorageScope {
  const raw = (readString('storage.scope', cwd) ?? 'project').toLowerCase()
  if (raw === 'project' || raw === 'user' || raw === 'named') return raw
  throw new Error(
    `Invalid storage.scope '${raw}' (expected: project | user | named)`,
  )
}

/**
 * Computes the SQLite database file path for a scope.
 *
 *   - project → `<cwd>/.gitsema/index.db`         (today's default)
 *   - user    → `~/.gitsema/index.db`
 *   - named   → `~/.gitsema/named/<name>.db`       (or `storage.metadata.url` if a path)
 *
 * An explicit `storage.metadata.url` that looks like a filesystem path always
 * wins (it is treated as the SQLite file location).
 */
export function resolveSqliteDbPath(
  scope: StorageScope,
  cwd: string,
  opts: { metadataUrl?: string; name?: string } = {},
): string {
  const explicit = opts.metadataUrl
  if (explicit && !explicit.includes('://')) {
    return isAbsolute(explicit) ? explicit : join(cwd, explicit)
  }

  switch (scope) {
    case 'project':
      return join(cwd, '.gitsema', 'index.db')
    case 'user':
      return join(homedir(), '.gitsema', 'index.db')
    case 'named': {
      const name = opts.name
      if (!name) {
        throw new Error("storage.scope 'named' requires storage.name to be set")
      }
      if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        throw new Error(`Invalid storage.name '${name}' (allowed: A-Z a-z 0-9 . _ -)`)
      }
      return join(homedir(), '.gitsema', 'named', `${name}.db`)
    }
  }
}

/**
 * Resolves the active storage profile from configuration.
 *
 * For the default (and only Phase-101) backend `sqlite`, the returned profile's
 * `location` is the resolved DB file path. Note: this does not by itself make a
 * non-default path the active session — wrap work in `withStorageProfile()` (or
 * the future CLI entrypoint wiring) to activate it.
 */
const profileCache = new Map<string, StorageProfile>()

/**
 * Cached variant of `resolveStorageProfile()`.
 *
 * Config files and env vars are read once per `cwd` and the resulting profile
 * is memoized — this is what lets hot loops (search/indexing) call
 * `getCachedStorageProfile()` on every iteration without re-reading config.
 * Call `clearStorageProfileCache()` after changing storage config at runtime
 * (tests, `gitsema config set`).
 */
export function getCachedStorageProfile(cwd: string = process.cwd()): StorageProfile {
  let profile = profileCache.get(cwd)
  if (!profile) {
    profile = resolveStorageProfile(cwd)
    profileCache.set(cwd, profile)
  }
  return profile
}

/** Clears the `getCachedStorageProfile()` memoization cache (tests / `config set`). */
export function clearStorageProfileCache(): void {
  profileCache.clear()
}

export function resolveStorageProfile(cwd: string = process.cwd()): StorageProfile {
  const backend = resolveBackend(cwd)

  if (backend !== 'sqlite') {
    throw new Error(
      `storage.backend '${backend}' is not yet implemented (planned for ` +
        `${backend === 'postgres' ? 'Phase 102' : 'Phase 103'}). ` +
        `Use 'sqlite' for now — see docs/storage-backends-plan.md.`,
    )
  }

  const scope = resolveScope(cwd)
  const metadataUrl = readString('storage.metadata.url', cwd)
  const name = readString('storage.name', cwd)
  const ftsBackend = (readString('storage.fts.backend', cwd) ?? 'fts5').toLowerCase()
  const ftsEnabled = ftsBackend !== 'none'

  const dbPath = resolveSqliteDbPath(scope, cwd, { metadataUrl, name })
  return new SqliteStorageProfile(scope, dbPath, ftsEnabled)
}

/**
 * Runs `fn` with `profile`'s database activated as the current DbSession.
 *
 * For SQLite this opens (or reuses) the session at `profile.location` and runs
 * `fn` inside `withDbSession`, so the profile's three stores all operate on that
 * database. For the default project scope this is the same file the rest of the
 * CLI uses, so behavior is unchanged.
 */
export function withStorageProfile<T>(profile: StorageProfile, fn: () => Promise<T>): Promise<T> {
  if (profile.backend !== 'sqlite') {
    throw new Error(`withStorageProfile: backend '${profile.backend}' is not yet implemented`)
  }
  const session = getOrOpenSessionAtPath(profile.location)
  return withDbSession(session, fn)
}
