/**
 * HTTP routes for the structural knowledge graph (Phase 110/111).
 *
 * Routes (under /api/v1/graph/):
 *   POST /hotspots — architectural risk = co-change × call-coupling × churn
 */

import { Router } from 'express'
import { z } from 'zod'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { computeHotspots, churnByPath } from '../../core/graph/hotspots.js'
import { parseLens } from '../../cli/lib/lens.js'

const HotspotsBodySchema = z.object({
  lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('hybrid'),
  topK: z.number().int().positive().optional().default(20),
})

export function graphRouter(): Router {
  const router = Router()

  router.post('/hotspots', async (req, res) => {
    const parsed = HotspotsBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const churn = profile.backend === 'sqlite' ? churnByPath() : new Map<string, number>()
      const result = await computeHotspots(profile.graph, {
        lens: parseLens(parsed.data.lens, 'hybrid'),
        topK: parsed.data.topK,
        churnByPath: churn,
      })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
