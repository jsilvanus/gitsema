import { execSync } from 'node:child_process'
import { getActiveSession, getRawDb } from '../db/sqlite.js'

export interface GcStats { total: number; removed: number; dryRun: boolean; elapsed: number }

export async function runGarbageCollection(opts: { dryRun?: boolean; repoPath?: string } = {}): Promise<GcStats> {
  const { dryRun = false, repoPath = '.' } = opts
  const start = Date.now()

  // 1. Get reachable blob hashes from git
  let out: string
  try {
    out = execSync('git rev-list --all --objects', { cwd: repoPath, encoding: 'utf8' })
  } catch (err) {
    throw new Error(`git rev-list failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  const reachable = new Set<string>()
  for (const line of out.split('\n')) {
    const parts = line.trim().split(' ')
    if (parts.length >= 1 && /^[0-9a-f]{4,}$/.test(parts[0])) reachable.add(parts[0])
  }

  const { rawDb } = getActiveSession()
  // Get all blobs present in embeddings table (primary source of truth)
  const rows = rawDb.prepare('SELECT DISTINCT blob_hash FROM embeddings').all() as Array<{ blob_hash: string }>
  const all = rows.map((r) => r.blob_hash)
  const unreachable = all.filter((h) => !reachable.has(h))

  const stats: GcStats = { total: all.length, removed: 0, dryRun, elapsed: 0 }

  if (!dryRun && unreachable.length > 0) {
    const tx = rawDb.transaction((hashes: string[]) => {
      const placeholders = hashes.map(() => '?').join(',')
      const tables = ['embeddings','chunks','chunk_embeddings','paths','blob_commits','blob_branches','blob_fts','symbols','symbol_embeddings','cluster_assignments']
      for (const t of tables) {
        rawDb.prepare(`DELETE FROM ${t} WHERE blob_hash IN (${placeholders})`).run(...hashes)
      }
    })
    tx(unreachable)
    stats.removed = unreachable.length
  } else {
    stats.removed = unreachable.length
  }

  stats.elapsed = Date.now() - start
  return stats
}
