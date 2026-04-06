import { getActiveSession } from '../db/sqlite.js'

export interface RepoEntry {
  id: string
  name: string
  url?: string | null
  addedAt: number
}

export function addRepo(dbSession: ReturnType<typeof getActiveSession>, id: string, name: string, url?: string | null): void {
  const { rawDb } = dbSession
  const now = Math.floor(Date.now() / 1000)
  rawDb.prepare('INSERT OR REPLACE INTO repos (id, name, url, added_at) VALUES (?, ?, ?, ?)').run(id, name, url ?? null, now)
}

export function listRepos(dbSession: ReturnType<typeof getActiveSession>): RepoEntry[] {
  const { rawDb } = dbSession
  const rows = rawDb.prepare('SELECT id, name, url, added_at FROM repos ORDER BY added_at DESC').all() as Array<{ id: string; name: string; url: string | null; added_at: number }>
  return rows.map((r) => ({ id: r.id, name: r.name, url: r.url ?? undefined, addedAt: r.added_at }))
}

export function getRepo(dbSession: ReturnType<typeof getActiveSession>, id: string): RepoEntry | null {
  const { rawDb } = dbSession
  const row = rawDb.prepare('SELECT id, name, url, added_at FROM repos WHERE id = ?').get(id) as { id: string; name: string; url: string | null; added_at: number } | undefined
  if (!row) return null
  return { id: row.id, name: row.name, url: row.url ?? undefined, addedAt: row.added_at }
}
