/**
 * HTTP routes for analysis commands (Phase 34).
 *
 * Routes (under /api/v1/analysis/):
 *   POST /clusters      — k-means cluster all indexed blobs
 *   POST /change-points — find concept change points in history
 *   POST /author        — attribute a semantic concept to authors
 *   POST /impact        — find semantically coupled blobs for a file
 */

import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import { computeClusters, getBlobHashesOnBranch } from '../../core/search/clustering.js'
import { computeConceptChangePoints } from '../../core/search/changePoints.js'
import { computeAuthorContributions } from '../../core/search/authorSearch.js'
import { computeImpact } from '../../core/search/impact.js'

const ClustersBodySchema = z.object({
  k: z.number().int().positive().optional().default(8),
  topKeywords: z.number().int().positive().optional().default(5),
  useEnhancedLabels: z.boolean().optional().default(false),
  branch: z.string().optional(),
})

const ChangePointsBodySchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().optional().default(50),
  threshold: z.number().min(0).max(2).optional().default(0.3),
  topPoints: z.number().int().positive().optional().default(5),
  branch: z.string().optional(),
})

const AuthorBodySchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().optional().default(50),
  topAuthors: z.number().int().positive().optional().default(10),
  branch: z.string().optional(),
})

const ImpactBodySchema = z.object({
  file: z.string().min(1),
  topK: z.number().int().positive().optional().default(10),
  branch: z.string().optional(),
})

export interface AnalysisRouterDeps {
  textProvider: EmbeddingProvider
}

export function analysisRouter(deps: AnalysisRouterDeps): Router {
  const { textProvider } = deps
  const router = Router()

  // POST /analysis/clusters
  router.post('/clusters', async (req, res) => {
    const parsed = ClustersBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const blobHashFilter = opts.branch ? getBlobHashesOnBranch(opts.branch) : undefined
      const report = await computeClusters({
        k: opts.k,
        topKeywords: opts.topKeywords,
        useEnhancedLabels: opts.useEnhancedLabels,
        blobHashFilter,
      })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/change-points
  router.post('/change-points', async (req, res) => {
    const parsed = ChangePointsBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let queryEmbedding: Embedding
    try {
      queryEmbedding = await textProvider.embed(opts.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const report = computeConceptChangePoints(opts.query, queryEmbedding, {
        topK: opts.topK,
        threshold: opts.threshold,
        topPoints: opts.topPoints,
        branch: opts.branch,
      })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/author
  router.post('/author', async (req, res) => {
    const parsed = AuthorBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let queryEmbedding: Embedding
    try {
      queryEmbedding = await textProvider.embed(opts.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const contributions = await computeAuthorContributions(queryEmbedding, {
        topK: opts.topK,
        topAuthors: opts.topAuthors,
        branch: opts.branch,
      })
      res.json(contributions)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/impact
  router.post('/impact', async (req, res) => {
    const parsed = ImpactBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const report = await computeImpact(opts.file, textProvider, {
        topK: opts.topK,
        branch: opts.branch,
      })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
