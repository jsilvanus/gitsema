import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getActiveSession, openDatabaseAt, getOrOpenSessionAtPath, closeSessionAtPath } from '../db/sqlite.js'
import { vectorSearch } from '../search/analysis/vectorSearch.js'
import type { SearchResult, Embedding } from '../models/types.js'
import { mergeSearchResults } from '../search/analysis/vectorSearch.js'

export interface RepoEntry {
  id: string
  name: string
  url?: string | null
  dbPath?: string | null
  addedAt: number
  normalizedUrl?: string | null
  clonePath?: string | null
  lastIndexedAt?: number | null
  ephemeral?: boolean
}

export function addRepo(dbSession: ReturnType<typeof getActiveSession>, id: string, name: string, url?: string | null, dbPath?: string | null): void {
  const { rawDb } = dbSession
  const now = Math.floor(Date.now() / 1000)
  rawDb.prepare('INSERT OR REPLACE INTO repos (id, name, url, db_path, added_at) VALUES (?, ?, ?, ?, ?)').run(id, name, url ?? null, dbPath ?? null, now)
}

interface RepoRow {
  id: string
  name: string
  url: string | null
  db_path: string | null
  added_at: number
  normalized_url: string | null
  clone_path: string | null
  last_indexed_at: number | null
  ephemeral: number
}

const REPO_COLUMNS = 'id, name, url, db_path, added_at, normalized_url, clone_path, last_indexed_at, ephemeral'

function rowToRepoEntry(r: RepoRow): RepoEntry {
  return {
    id: r.id,
    name: r.name,
    url: r.url ?? undefined,
    dbPath: r.db_path ?? undefined,
    addedAt: r.added_at,
    normalizedUrl: r.normalized_url ?? undefined,
    clonePath: r.clone_path ?? undefined,
    lastIndexedAt: r.last_indexed_at ?? undefined,
    ephemeral: r.ephemeral === 1,
  }
}

export function listRepos(dbSession: ReturnType<typeof getActiveSession>): RepoEntry[] {
  const { rawDb } = dbSession
  const rows = rawDb.prepare(`SELECT ${REPO_COLUMNS} FROM repos ORDER BY added_at DESC`).all() as RepoRow[]
  return rows.map(rowToRepoEntry)
}

export function getRepo(dbSession: ReturnType<typeof getActiveSession>, id: string): RepoEntry | null {
  const { rawDb } = dbSession
  const row = rawDb.prepare(`SELECT ${REPO_COLUMNS} FROM repos WHERE id = ?`).get(id) as RepoRow | undefined
  if (!row) return null
  return rowToRepoEntry(row)
}

export interface MultiRepoSearchResult extends SearchResult {
  repoId: string
  repoName: string
}

/**
 * Search across multiple registered repos.
 * Opens each repo's DB (if db_path is set), runs vectorSearch, tags with repoId, and merges.
 */
export async function multiRepoSearch(
  mainSession: ReturnType<typeof getActiveSession>,
  queryEmbedding: Embedding,
  opts: { repoIds?: string[]; topK?: number; model?: string },
): Promise<MultiRepoSearchResult[]> {
  const { rawDb } = mainSession
  const topK = opts.topK ?? 10
  const model = opts.model

  // Load repos to search
  let repos: RepoEntry[]
  if (opts.repoIds && opts.repoIds.length > 0) {
    const placeholders = opts.repoIds.map(() => '?').join(',')
    const rows = rawDb.prepare(`SELECT id, name, url, db_path, added_at FROM repos WHERE id IN (${placeholders}) ORDER BY added_at DESC`).all(...(opts.repoIds as [string, ...string[]])) as Array<{ id: string; name: string; url: string | null; db_path: string | null; added_at: number }>
    repos = rows.map((r) => ({ id: r.id, name: r.name, url: r.url ?? undefined, dbPath: r.db_path ?? undefined, addedAt: r.added_at }))
  } else {
    repos = listRepos(mainSession)
  }

  const allResults: MultiRepoSearchResult[] = []

  for (const repo of repos) {
    if (!repo.dbPath) continue
    try {
      const session = openDatabaseAt(repo.dbPath)
      // Temporarily set the session context so vectorSearch works
      // We pass the session directly via the rawDb approach in vectorSearch
      const results = vectorSearch(queryEmbedding, { topK, model })
      for (const r of results) {
        allResults.push({ ...r, repoId: repo.id, repoName: repo.name })
      }
    } catch {
      // skip unreachable repos
    }
  }

  // Merge and re-rank by score (descending)
  allResults.sort((a, b) => b.score - a.score)
  return allResults.slice(0, topK)
}

// ---------------------------------------------------------------------------
// Persistent server-side repo storage (GITSEMA_DATA_DIR registry)
// ---------------------------------------------------------------------------

/**
 * Resolves the root directory for persisted server-side repo clones + indexes.
 * Configurable via GITSEMA_DATA_DIR; defaults to `~/.gitsema/data`.
 */
export function getDataDir(): string {
  return process.env.GITSEMA_DATA_DIR ?? join(homedir(), '.gitsema', 'data')
}

/** Returns `$GITSEMA_DATA_DIR/repos/<repoId>` */
export function getRepoDir(repoId: string): string {
  return join(getDataDir(), 'repos', repoId)
}

/** Returns `$GITSEMA_DATA_DIR/repos/<repoId>/repo` (git clone working copy) */
export function getRepoClonePath(repoId: string): string {
  return join(getRepoDir(repoId), 'repo')
}

/** Returns `$GITSEMA_DATA_DIR/repos/<repoId>/index.db` (this repo's gitsema index) */
export function getRepoDbPath(repoId: string): string {
  return join(getRepoDir(repoId), 'index.db')
}

let _registrySession: ReturnType<typeof getOrOpenSessionAtPath> | undefined

/**
 * Opens (or returns the cached) registry database at `$GITSEMA_DATA_DIR/registry.db`.
 * Runs the full app schema/migrations like any other gitsema DB — only the
 * `repos` and `repo_tokens` tables are used here.
 */
export function getRegistrySession(): ReturnType<typeof getOrOpenSessionAtPath> {
  if (!_registrySession) {
    _registrySession = getOrOpenSessionAtPath(join(getDataDir(), 'registry.db'))
  }
  return _registrySession
}

/**
 * Closes the cached registry session (if open), releasing its sqlite file
 * handle. Used in tests on Windows, where an open WAL-mode database file
 * cannot be deleted while held open.
 */
export function closeRegistrySession(): void {
  if (!_registrySession) return
  closeSessionAtPath(_registrySession.dbPath)
  _registrySession = undefined
}

/**
 * Normalizes a repo URL for deduplication: strips userinfo/credentials,
 * a trailing `.git`, and trailing slashes, and lowercases the host.
 * SCP-style URLs (`git@host:owner/repo.git`) are normalized by lowercasing.
 */
export function normalizeRepoUrl(rawUrl: string): string {
  if (!rawUrl.includes('://')) {
    // SCP-style: git@host:owner/repo(.git)?
    return rawUrl.toLowerCase().replace(/\.git$/, '')
  }
  try {
    const parsed = new URL(rawUrl)
    parsed.username = ''
    parsed.password = ''
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\.git$/, '') || '/'
    return parsed.toString()
  } catch {
    return rawUrl.toLowerCase()
  }
}

/**
 * Derives a stable, filesystem-safe repo ID from a normalized repo URL.
 * The same normalized URL always yields the same ID, so repeated
 * registrations resolve to the same on-disk directory.
 */
export function deriveRepoId(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16)
}

/**
 * Looks up a persisted repo by its normalized URL.
 */
export function findRepoByNormalizedUrl(
  session: ReturnType<typeof getOrOpenSessionAtPath>,
  normalizedUrl: string,
): RepoEntry | null {
  const { rawDb } = session
  const row = rawDb.prepare(`SELECT ${REPO_COLUMNS} FROM repos WHERE normalized_url = ?`).get(normalizedUrl) as RepoRow | undefined
  if (!row) return null
  return rowToRepoEntry(row)
}

/**
 * Registers a newly persisted repo in the registry (or replaces an existing
 * entry with the same id). Used by the remote-index route on first clone of
 * a given URL.
 */
export function registerPersistedRepo(
  session: ReturnType<typeof getOrOpenSessionAtPath>,
  entry: {
    id: string
    name: string
    url: string
    normalizedUrl: string
    clonePath: string
    dbPath: string
    ephemeral?: boolean
  },
): void {
  const { rawDb } = session
  const now = Math.floor(Date.now() / 1000)
  rawDb.prepare(`
    INSERT INTO repos (id, name, url, db_path, added_at, normalized_url, clone_path, last_indexed_at, ephemeral)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      url = excluded.url,
      db_path = excluded.db_path,
      normalized_url = excluded.normalized_url,
      clone_path = excluded.clone_path,
      ephemeral = excluded.ephemeral
  `).run(entry.id, entry.name, entry.url, entry.dbPath, now, entry.normalizedUrl, entry.clonePath, entry.ephemeral ? 1 : 0)
}

/** Updates `last_indexed_at` to now for the given repo id. */
export function touchLastIndexed(session: ReturnType<typeof getOrOpenSessionAtPath>, repoId: string): void {
  const { rawDb } = session
  rawDb.prepare('UPDATE repos SET last_indexed_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), repoId)
}

/** Removes a repo's registry entry. Does not touch its on-disk clone/index. */
export function removeRepo(session: ReturnType<typeof getOrOpenSessionAtPath>, repoId: string): void {
  const { rawDb } = session
  rawDb.prepare('DELETE FROM repos WHERE id = ?').run(repoId)
}

// ---------------------------------------------------------------------------
// Per-repo mutex (serializes concurrent clone/fetch/index for the same repoId)
// ---------------------------------------------------------------------------

const _repoLocks = new Map<string, Promise<void>>()

/**
 * Runs `fn` exclusively with respect to any other call to `withRepoLock` for
 * the same `repoId`. Concurrent requests for the same repo are serialized so
 * that `git fetch`/incremental indexing never races on the same clone or DB.
 */
export async function withRepoLock<T>(repoId: string, fn: () => Promise<T>): Promise<T> {
  const previous = _repoLocks.get(repoId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  _repoLocks.set(repoId, previous.then(() => current))

  await previous
  try {
    return await fn()
  } finally {
    release()
    if (_repoLocks.get(repoId) === current) {
      _repoLocks.delete(repoId)
    }
  }
}
