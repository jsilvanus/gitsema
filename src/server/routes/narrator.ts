/**
 * HTTP routes for narrator/explainer endpoints.
 *
 * Routes (under /api/v1/):
 *   POST /narrate   — generate a narrative of repository development history
 *   POST /explain   — explain a bug/error topic by tracing through git history
 *
 * Both routes use the DB-backed narrator model config system.
 * Safe-by-default: returns evidence only unless `evidenceOnly: false` is sent
 * explicitly (Phase 144) — mirrors the CLI's `--narrate`/`--evidence-only`
 * default (no LLM/network call unless explicitly opted in).
 */

import { Router } from 'express'
import { z } from 'zod'
import { ByokUrlValidationError, resolveNarratorProvider } from '../../core/narrator/resolveNarrator.js'
import { runNarrate, runExplain } from '../../core/narrator/narrator.js'
import { parseLens } from '../../cli/lib/lens.js'

export const narratorRouter = Router()

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Request-scoped BYOK credentials (Phase 130 / locked-model-set-plan.md §5
 * Phase 3). Never persisted, never allow-list checked — bypasses the DB
 * entirely via `resolveNarratorProvider({ byok })`.
 */
const ByokSchema = z.object({
  httpUrl: z.string().min(1),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().optional(),
})

/** Cross-cutting `--lens` toggle (Phase 109/111): which signal(s) drive structural enrichment. */
const LensSchema = z.enum(['semantic', 'structural', 'hybrid'])

const NarrateBodySchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
  range: z.string().optional(),
  focus: z.enum(['bugs', 'features', 'ops', 'security', 'deps', 'performance', 'all']).optional().default('all'),
  format: z.enum(['md', 'text', 'json']).optional().default('md'),
  maxCommits: z.number().int().positive().optional(),
  narratorModelId: z.number().int().positive().optional(),
  model: z.string().optional(),
  byok: ByokSchema.optional(),
  /**
   * Phase 144: mirrors the CLI's `--narrate`/`--evidence-only` toggle, which
   * HTTP callers previously had no way to request explicitly. Default
   * (omitted/`undefined`) matches `runNarrate`'s own default of `true` —
   * evidence-only, no LLM call.
   */
  evidenceOnly: z.boolean().optional(),
  /**
   * Phase 111/144: accepted for CLI flag-surface parity. `narrate` has no
   * single-file target to enrich (unlike `explain`'s `--files`), so this is
   * currently a no-op for `/narrate` — see Phase 144 deviation notes.
   */
  lens: LensSchema.optional(),
})

const ExplainBodySchema = z.object({
  topic: z.string().min(1),
  since: z.string().optional(),
  until: z.string().optional(),
  format: z.enum(['md', 'text', 'json']).optional().default('md'),
  narratorModelId: z.number().int().positive().optional(),
  model: z.string().optional(),
  byok: ByokSchema.optional(),
  /** Phase 144: same semantics as `NarrateBodySchema.evidenceOnly`. */
  evidenceOnly: z.boolean().optional(),
  /** Phase 144: mirrors CLI `explain --log <path>` — error/stack-trace context file. */
  log: z.string().optional(),
  /** Phase 144: mirrors CLI `explain --files <glob>` — restricts search scope. */
  files: z.string().optional(),
  /**
   * Phase 111/144: mirrors CLI `explain --lens`. When `structural`/`hybrid`
   * and `files` is a concrete path, the response includes a `structuralContext`
   * field (call-graph / co-change enrichment), same as the CLI's post-run
   * structural context append.
   */
  lens: LensSchema.optional(),
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
  let provider: Awaited<ReturnType<typeof resolveNarratorProvider>>
  try {
    provider = await resolveNarratorProvider({
      narratorModelId: body.narratorModelId,
      modelName: body.model,
      byok: body.byok,
    })
  } catch (err) {
    if (err instanceof ByokUrlValidationError) {
      res.status(400).json({ error: err.message })
      return
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }

  try {
    const result = await runNarrate(provider, {
      since: body.since,
      until: body.until,
      range: body.range,
      focus: body.focus,
      format: body.format,
      maxCommits: body.maxCommits,
      evidenceOnly: body.evidenceOnly,
    })
    res.json({
      prose: result.prose,
      commitCount: result.commitCount,
      citations: result.citations,
      redactedFields: result.redactedFields,
      llmEnabled: result.llmEnabled,
      format: result.format,
      evidence: result.evidence,
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
  let provider: Awaited<ReturnType<typeof resolveNarratorProvider>>
  try {
    provider = await resolveNarratorProvider({
      narratorModelId: body.narratorModelId,
      modelName: body.model,
      byok: body.byok,
    })
  } catch (err) {
    if (err instanceof ByokUrlValidationError) {
      res.status(400).json({ error: err.message })
      return
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }

  try {
    const result = await runExplain(provider, body.topic, {
      since: body.since,
      until: body.until,
      log: body.log,
      files: body.files,
      format: body.format,
      evidenceOnly: body.evidenceOnly,
    })

    // Structural enrichment (Phase 110/111/144): mirrors the CLI's own
    // post-run append in `explainCommand` — when a structural/hybrid lens is
    // requested and a concrete `files` path is given, include grounded
    // call-graph / co-change context in the response. Default `semantic`
    // lens (or no `files`) adds nothing, keeping the response shape
    // unchanged for existing callers.
    let structuralContext: string | undefined
    const lens = parseLens(body.lens, 'semantic')
    if (lens !== 'semantic' && body.files) {
      try {
        const { getCachedStorageProfile } = await import('../../core/storage/resolveProfile.js')
        const { structuralContextForPath, formatStructuralContext } = await import('../../core/graph/structuralContext.js')
        const graph = getCachedStorageProfile(process.cwd()).graph
        const ctx = await structuralContextForPath(graph, body.files)
        structuralContext = formatStructuralContext(ctx)
      } catch {
        // graph unavailable — skip enrichment silently, same as the CLI
      }
    }

    res.json({
      prose: result.prose,
      commitCount: result.commitCount,
      citations: result.citations,
      redactedFields: result.redactedFields,
      llmEnabled: result.llmEnabled,
      format: result.format,
      evidence: result.evidence,
      ...(structuralContext ? { structuralContext, lens } : {}),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  } finally {
    await provider.destroy()
  }
})
