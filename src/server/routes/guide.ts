/**
 * HTTP routes for the guide chat feature.
 *
 * POST /api/v1/guide/chat — single-turn chat endpoint backed by the gitsema
 *   guide agent loop (chattydeer `runAgentLoop` — repo_stats, recent_commits,
 *   narrate_repo, explain_topic, semantic_search; up to 5 roundtrips).
 *   Body: { question: string, model?: string, guideModelId?: number, includeContext?: boolean, lens?: string }
 *   Response: { answer, contextUsed, llmEnabled, roundtrips?, toolCallsUsed? }
 *
 * `lens` (Phase 145) mirrors CLI `guide --lens <semantic|structural|hybrid>`
 * (Phase 111): it doesn't change `runGuide`'s options, it appends the same
 * "(Lens preference: ...)" hint suffix to the question before it's sent to
 * the agent loop, biasing tool choice toward call_graph/blast_radius/hotspots
 * for structural/hybrid — see `guideCommand`'s `withLens()` in
 * `src/cli/commands/guide.ts`, which this route replicates exactly so
 * CLI and HTTP callers get identical prompting for the same lens value.
 *
 * Remote multi-turn sessions (CLI `--interactive`/`-i`, which reuses one
 * agent session across turns) are explicitly out of scope for this route —
 * see docs/PLAN.md Phase 145 Status note and docs/feature-ideas.md for the
 * deferred session-design question.
 *
 * For full OpenAI /v1/chat/completions pass-through (not yet wired), see
 * docs/chattydeer_contract.md.
 */

import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { runGuide } from '../../cli/commands/guide.js'
import { parseLens } from '../../cli/lib/lens.js'

const router = Router()

/**
 * Request-scoped BYOK credentials (Phase 130 / locked-model-set-plan.md §5
 * Phase 3). Never persisted, never allow-list checked — bypasses the DB
 * entirely via `runGuide({ byok })` -> `resolveGuideConfig({ byok })`.
 */
const ByokSchema = z.object({
  http_url: z.string().min(1).describe('OpenAI-compatible base URL for the LLM endpoint'),
  api_key: z.string().optional().describe('Bearer token / API key'),
  model: z.string().optional().describe('Model id sent to the chat-completions API'),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().optional(),
})

const GuideChatBodySchema = z.object({
  question: z.string().min(1).max(4000).describe('The question to ask the guide'),
  model: z.string().optional().describe('Guide/narrator model name to use (overrides active selection)'),
  guide_model_id: z.number().int().positive().optional().describe('embed_config.id of the guide model'),
  include_context: z.boolean().optional().default(true).describe('Whether to gather git context before answering (default: true)'),
  lens: z.enum(['semantic', 'structural', 'hybrid']).optional().describe('Structural/hybrid tool-bias hint (Phase 111) — prefers call_graph/blast_radius/hotspots when set to structural or hybrid (default: semantic)'),
  byok: ByokSchema.optional().describe('Request-scoped bring-your-own-key credentials, bypasses configured/allow-listed models, never persisted'),
})

/**
 * POST /api/v1/guide/chat
 *
 * Ask the gitsema guide a question about the repository.
 * Uses the active guide model (falls back to narrator model).
 * Returns the answer + whether LLM was enabled.
 */
router.post('/chat', async (req: Request, res: Response) => {
  const parsed = GuideChatBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues })
    return
  }

  const { question, model, guide_model_id, include_context, lens: lensOpt, byok } = parsed.data

  // Mirrors `guideCommand`'s `withLens()` in src/cli/commands/guide.ts: a
  // structural/hybrid lens appends a hint to the question so the agent loop
  // prefers the structural tools; semantic (default) leaves it unchanged.
  const lens = parseLens(lensOpt, 'semantic')
  const lensHint = lens !== 'semantic'
    ? `\n\n(Lens preference: ${lens} — prefer the structural tools call_graph, blast_radius, and hotspots where relevant.)`
    : ''
  const questionWithLens = question + lensHint

  try {
    const result = await runGuide(questionWithLens, {
      guideModelId: guide_model_id,
      model,
      includeContext: include_context,
      byok: byok ? {
        httpUrl: byok.http_url,
        ...(byok.api_key ? { apiKey: byok.api_key } : {}),
        ...(byok.model ? { model: byok.model } : {}),
        ...(byok.max_tokens !== undefined ? { maxTokens: byok.max_tokens } : {}),
        ...(byok.temperature !== undefined ? { temperature: byok.temperature } : {}),
      } : undefined,
    })

    res.json({
      answer: result.answer,
      contextUsed: result.contextUsed,
      llmEnabled: result.llmEnabled,
      ...(result.roundtrips !== undefined ? { roundtrips: result.roundtrips } : {}),
      ...(result.toolCallsUsed !== undefined ? { toolCallsUsed: result.toolCallsUsed } : {}),
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

export default router
