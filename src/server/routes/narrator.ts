/**
 * HTTP routes for narrator/explainer endpoints.
 *
 * Routes (under /api/v1/):
 *   POST /narrate   — generate a narrative of repository development history
 *   POST /explain   — explain a bug/error topic by tracing through git history
 *
 * Both routes use the DB-backed narrator model config system.
 * Safe-by-default: returns a placeholder when no narrator model is configured.
 */

import { Router } from 'express'
import { z } from 'zod'
import { resolveNarratorProvider, runNarrate, runExplain } from '../../core/narrator/index.js'

export const narratorRouter = Router()

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const NarrateBodySchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
  range: z.string().optional(),
  focus: z.enum(['bugs', 'features', 'ops', 'security', 'deps', 'performance', 'all']).optional().default('all'),
  format: z.enum(['md', 'text', 'json']).optional().default('md'),
  maxCommits: z.number().int().positive().optional(),
  narratorModelId: z.number().int().positive().optional(),
  model: z.string().optional(),
})

const ExplainBodySchema = z.object({
  topic: z.string().min(1),
  since: z.string().optional(),
  until: z.string().optional(),
  format: z.enum(['md', 'text', 'json']).optional().default('md'),
  narratorModelId: z.number().int().positive().optional(),
  model: z.string().optional(),
})

// ---------------------------------------------------------------------------
// POST /narrate
// ---------------------------------------------------------------------------

narratorRouter.post('/narrate', async (req, res) => {
  const parsed = NarrateBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
    return
  }

  const body = parsed.data
  const provider = resolveNarratorProvider({
    narratorModelId: body.narratorModelId,
    modelName: body.model,
  })

  try {
    const result = await runNarrate(provider, {
      since: body.since,
      until: body.until,
      range: body.range,
      focus: body.focus,
      format: body.format,
      maxCommits: body.maxCommits,
    })
    res.json({
      prose: result.prose,
      commitCount: result.commitCount,
      citations: result.citations,
      redactedFields: result.redactedFields,
      llmEnabled: result.llmEnabled,
      format: result.format,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  } finally {
    await provider.destroy()
  }
})

// ---------------------------------------------------------------------------
// POST /explain
// ---------------------------------------------------------------------------

narratorRouter.post('/explain', async (req, res) => {
  const parsed = ExplainBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
    return
  }

  const body = parsed.data
  const provider = resolveNarratorProvider({
    narratorModelId: body.narratorModelId,
    modelName: body.model,
  })

  try {
    const result = await runExplain(provider, body.topic, {
      since: body.since,
      until: body.until,
      format: body.format,
    })
    res.json({
      prose: result.prose,
      commitCount: result.commitCount,
      citations: result.citations,
      redactedFields: result.redactedFields,
      llmEnabled: result.llmEnabled,
      format: result.format,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  } finally {
    await provider.destroy()
  }
})
