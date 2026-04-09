/**
 * HTTP routes for the guide chat feature.
 *
 * POST /api/v1/guide/chat — OpenAI-compatible single-turn chat endpoint.
 *   Body: { question: string, model?: string, guideModelId?: number, includeContext?: boolean }
 *   Response: { answer, contextUsed, llmEnabled, citations }
 *
 * For full OpenAI /v1/chat/completions compatibility including function_calls,
 * see docs/chattydeer_contract.md for the required chattydeer API extensions.
 */

import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { runGuide } from '../../cli/commands/guide.js'

const router = Router()

const GuideChatBodySchema = z.object({
  question: z.string().min(1).max(4000).describe('The question to ask the guide'),
  model: z.string().optional().describe('Guide/narrator model name to use (overrides active selection)'),
  guide_model_id: z.number().int().positive().optional().describe('embed_config.id of the guide model'),
  include_context: z.boolean().optional().default(true).describe('Whether to gather git context before answering (default: true)'),
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

  const { question, model, guide_model_id, include_context } = parsed.data

  try {
    const result = await runGuide(question, {
      guideModelId: guide_model_id,
      model,
      includeContext: include_context,
    })

    res.json({
      answer: result.answer,
      contextUsed: result.contextUsed,
      llmEnabled: result.llmEnabled,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

export default router
