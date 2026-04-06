/**
 * Projections routes (Phase 55 — Embedding Space Explorer).
 * GET /projections?model=<model>  — return 2D projection coordinates + paths
 */

import { Router } from 'express'
import { getActiveSession } from '../../core/db/sqlite.js'

export function projectionsRouter(): Router {
  const router = Router()

  router.get('/', (req, res) => {
    try {
      const model = typeof req.query.model === 'string' && req.query.model
        ? req.query.model
        : (process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text')

      const session = getActiveSession()
      const pointRows = session.rawDb.prepare(
        `SELECT blob_hash, x, y FROM projections WHERE model = ? ORDER BY id LIMIT 50000`,
      ).all(model) as Array<{ blob_hash: string; x: number; y: number }>

      if (pointRows.length === 0) {
        res.json({ points: [], paths: {}, message: "No projections found. Run 'gitsema project' first." })
        return
      }

      // Fetch paths for each blob hash
      const hashes = pointRows.map((r) => r.blob_hash)
      const chunkSize = 500
      const pathMap: Record<string, string[]> = {}
      for (let i = 0; i < hashes.length; i += chunkSize) {
        const chunk = hashes.slice(i, i + chunkSize)
        const placeholders = chunk.map(() => '?').join(',')
        const pathRows = session.rawDb.prepare(
          `SELECT blob_hash, path FROM paths WHERE blob_hash IN (${placeholders})`,
        ).all(...(chunk as [string, ...string[]])) as Array<{ blob_hash: string; path: string }>
        for (const r of pathRows) {
          if (!pathMap[r.blob_hash]) pathMap[r.blob_hash] = []
          pathMap[r.blob_hash].push(r.path)
        }
      }

      const points = pointRows.map((r) => ({ blobHash: r.blob_hash, x: r.x, y: r.y }))
      res.json({ points, paths: pathMap, model })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
