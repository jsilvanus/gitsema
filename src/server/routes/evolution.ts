import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import { computeEvolution, computeConceptEvolution } from '../../core/search/temporal/evolution.js'
import { buildAlerts, enrichAlerts } from '../../cli/commands/evolution.js'
import { buildProviderForModel } from '../../core/embedding/providerFactory.js'
import { formatDate } from '../../core/search/ranking.js'
import { getBlobContent } from '../../core/indexing/blobStore.js'

const ModelOverrideSchema = z.object({
  model: z.string().optional(),
  textModel: z.string().optional(),
  codeModel: z.string().optional(),
})

const FileEvolutionBodySchema = z.object({
  path: z.string().min(1),
  threshold: z.number().min(0).max(2).optional().default(0.3),
  includeContent: z.boolean().optional().default(false),
  level: z.enum(['file', 'symbol']).optional().default('file'),
  branch: z.string().optional(),
  alerts: z.number().int().positive().optional(),
}).merge(ModelOverrideSchema)

const ConceptEvolutionBodySchema = z.object({
  query: z.string().min(1),
  top: z.number().int().positive().optional().default(50),
  threshold: z.number().min(0).max(2).optional().default(0.3),
  includeContent: z.boolean().optional().default(false),
  branch: z.string().optional(),
}).merge(ModelOverrideSchema)

export interface EvolutionRouterDeps {
  textProvider: EmbeddingProvider
}

/**
 * Resolves the effective query-embedding provider for a request, honoring
 * `model`/`textModel`/`codeModel` body overrides (Phase 139) — mirrors the
 * CLI's `resolveModels()` precedence (`textModel` first, then bare `model`)
 * without mutating `process.env`. Falls back to the router's shared
 * `textProvider` when no override is given.
 */
function resolveRequestProvider(
  base: EmbeddingProvider,
  overrides: { model?: string; textModel?: string; codeModel?: string },
): EmbeddingProvider {
  const modelName = overrides.textModel ?? overrides.model ?? overrides.codeModel
  if (!modelName) return base
  return buildProviderForModel(modelName)
}

export function evolutionRouter(deps: EvolutionRouterDeps): Router {
  const { textProvider } = deps
  const router = Router()

  router.post('/file', async (req, res) => {
    const parsed = FileEvolutionBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    const { path, threshold, includeContent, level, branch, alerts: alertsTopN } = parsed.data

    let entries
    try {
      entries = computeEvolution(path, undefined, { useSymbolLevel: level === 'symbol', branch })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
      return
    }

    let alerts: unknown
    if (alertsTopN !== undefined) {
      const candidates = buildAlerts(entries, threshold, alertsTopN)
      alerts = await enrichAlerts(candidates)
    }

    const result: Record<string, unknown> = {
      path,
      versions: entries.length,
      threshold,
      level,
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
    if (alerts !== undefined) {
      result.alerts = alerts
    }

    res.json(result)
  })

  router.post('/concept', async (req, res) => {
    const parsed = ConceptEvolutionBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    const { query, top, threshold, includeContent, branch, model, textModel, codeModel } = parsed.data

    let provider: EmbeddingProvider
    try {
      provider = resolveRequestProvider(textProvider, { model, textModel, codeModel })
    } catch (err) {
      res.status(400).json({ error: `Could not resolve model override: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    let queryEmbedding: Embedding
    try {
      queryEmbedding = await provider.embed(query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    const entries = computeConceptEvolution(queryEmbedding, top, branch)

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
