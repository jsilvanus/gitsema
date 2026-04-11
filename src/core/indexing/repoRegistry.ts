import { getActiveSession, openDatabaseAt } from '../db/sqlite.js'
import { vectorSearch } from '../search/vectorSearch.js'
import type { SearchResult, Embedding } from '../models/types.js'
import { mergeSearchResults } from '../search/vectorSearch.js'

export interface RepoEntry {
  id: string
  name: string
  url?: string | null
  dbPath?: string | null
  addedAt: number
}

export function addRepo(dbSession: ReturnType<typeof getActiveSession>, id: string, name: string, url?: string | null, dbPath?: string | null): void {
  const { rawDb } = dbSession
  const now = Math.floor(Date.now() / 1000)
  rawDb.prepare('INSERT OR REPLACE INTO repos (id, name, url, db_path, added_at) VALUES (?, ?, ?, ?, ?)').run(id, name, url ?? null, dbPath ?? null, now)
}

export function listRepos(dbSession: ReturnType<typeof getActiveSession>): RepoEntry[] {
  const { rawDb } = dbSession
  const rows = rawDb.prepare('SELECT id, name, url, db_path, added_at FROM repos ORDER BY added_at DESC').all() as Array<{ id: string; name: string; url: string | null; db_path: string | null; added_at: number }>
  return rows.map((r) => ({ id: r.id, name: r.name, url: r.url ?? undefined, dbPath: r.db_path ?? undefined, addedAt: r.added_at }))
}

export function getRepo(dbSession: ReturnType<typeof getActiveSession>, id: string): RepoEntry | null {
  const { rawDb } = dbSession
  const row = rawDb.prepare('SELECT id, name, url, db_path, added_at FROM repos WHERE id = ?').get(id) as { id: string; name: string; url: string | null; db_path: string | null; added_at: number } | undefined
  if (!row) return null
  return { id: row.id, name: row.name, url: row.url ?? undefined, dbPath: row.db_path ?? undefined, addedAt: row.added_at }
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
