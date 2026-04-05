import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import { computeEvolution, computeConceptEvolution } from '../../core/search/evolution.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { formatDate, shortHash } from '../../core/search/ranking.js'
import { getBlobContent } from '../../core/indexing/blobStore.js'

const FileEvolutionBodySchema = z.object({
  path: z.string().min(1),
  threshold: z.number().min(0).max(2).optional().default(0.3),
  includeContent: z.boolean().optional().default(false),
})

const ConceptEvolutionBodySchema = z.object({
  query: z.string().min(1),
  top: z.number().int().positive().optional().default(50),
  threshold: z.number().min(0).max(2).optional().default(0.3),
  includeContent: z.boolean().optional().default(false),
})

export interface EvolutionRouterDeps {
  textProvider: EmbeddingProvider
}

export function evolutionRouter(deps: EvolutionRouterDeps): Router {
  const { textProvider } = deps
  const router = Router()

  router.post('/file', (req, res) => {
    const parsed = FileEvolutionBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    const { path, threshold, includeContent } = parsed.data
    const entries = computeEvolution(path)

    const result = {
      path,
      versions: entries.length,
      threshold,
      timeline: entries.map((e, i) => {
        const item: Record<string, unknown> = {
          index: i,
          date: formatDate(e.timestamp),
          timestamp: e.timestamp,
          blobHash: e.blobHash,
          commitHash: e.commitHash,
          distFromPrev: e.distFromPrev,
          distFromOrigin: e.distFromOrigin,
          isOrigin: i === 0,
          isLargeChange: i > 0 && e.distFromPrev >= threshold,
        }
        if (includeContent) {
          item.content = getBlobContent(e.blobHash) ?? null
        }
        return item
      }),
      summary: {
        largeChanges: entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length,
        maxDistFromPrev: entries.length > 0 ? Math.max(...entries.map((e) => e.distFromPrev), 0) : 0,
        totalDrift: entries.length > 0 ? entries[entries.length - 1].distFromOrigin : 0,
      },
    }

    res.json(result)
  })

  router.post('/concept', async (req, res) => {
    const parsed = ConceptEvolutionBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    const { query, top, threshold, includeContent } = parsed.data

    let queryEmbedding: Embedding
    try {
      queryEmbedding = await textProvider.embed(query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    const entries = computeConceptEvolution(queryEmbedding, top)

    const result = {
      query,
      entries: entries.length,
      threshold,
      timeline: entries.map((e, i) => {
        const item: Record<string, unknown> = {
          index: i,
          date: formatDate(e.timestamp),
          timestamp: e.timestamp,
          blobHash: e.blobHash,
          commitHash: e.commitHash,
          paths: e.paths,
          score: e.score,
          distFromPrev: e.distFromPrev,
          isOrigin: i === 0,
          isLargeChange: i > 0 && e.distFromPrev >= threshold,
        }
        if (includeContent) {
          item.content = getBlobContent(e.blobHash) ?? null
        }
        return item
      }),
      summary: {
        largeChanges: entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length,
        maxDistFromPrev: entries.length > 0 ? Math.max(...entries.map((e) => e.distFromPrev), 0) : 0,
        avgScore: entries.length > 0 ? entries.reduce((s, e) => s + e.score, 0) / entries.length : 0,
      },
    }

    res.json(result)
  })

  return router
}
