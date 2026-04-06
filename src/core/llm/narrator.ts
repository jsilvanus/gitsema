/**
 * LLM-powered narration for evolution timelines (Phase 56).
 *
 * Calls an OpenAI-compatible chat completion endpoint to generate a
 * human-readable summary of semantic drift in a file's history.
 *
 * Configuration (via environment variables):
 *   GITSEMA_LLM_URL   — base URL of the OpenAI-compatible API (required)
 *   GITSEMA_LLM_MODEL — model name (default: gpt-4o-mini)
 *   GITSEMA_API_KEY   — Bearer token (reused from embedding config, optional)
 *
 * Falls back gracefully when GITSEMA_LLM_URL is not configured.
 */

import type { EvolutionEntry } from '../search/evolution.js'

export async function narrateEvolution(
  filePath: string,
  entries: EvolutionEntry[],
  threshold: number,
): Promise<string> {
  const llmUrl = process.env.GITSEMA_LLM_URL
  if (!llmUrl) {
    return '(LLM narration unavailable — set GITSEMA_LLM_URL to enable)'
  }

  const model = process.env.GITSEMA_LLM_MODEL ?? 'gpt-4o-mini'
  const apiKey = process.env.GITSEMA_API_KEY ?? ''

  // Build a compact timeline summary as prompt context
  const timelineLines = entries.slice(0, 20).map((e) => {
    const date = new Date(e.timestamp * 1000).toISOString().slice(0, 10)
    const flag = e.distFromPrev >= threshold ? ' *** LARGE CHANGE' : ''
    return `${date}  dist_from_prev=${e.distFromPrev.toFixed(3)}  dist_from_origin=${e.distFromOrigin.toFixed(3)}${flag}`
  })

  const significantChanges = entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).slice(0, 10)

  const prompt = `You are a software evolution analyst. Given the semantic drift timeline below for the file "${filePath}", write a concise 2-4 sentence paragraph summarizing the key semantic shifts. Focus on when significant changes occurred and what they likely indicate about the file's evolution.

Timeline (cosine distance from previous version, threshold=${threshold}):
${timelineLines.join('\n')}

Significant changes: ${significantChanges.length} version(s) exceeded the threshold.
Total versions: ${entries.length}

Provide a concise narrative summary:`

  try {
    const response = await fetch(`${llmUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return `(LLM narration failed: HTTP ${response.status} — ${errText.slice(0, 100)})`
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }

    if (data.error) {
      return `(LLM narration failed: ${data.error.message ?? 'unknown error'})`
    }

    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) {
      return '(LLM narration returned an empty response)'
    }

    return content
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}
