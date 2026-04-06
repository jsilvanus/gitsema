/**
 * LLM-powered narration for gitsema outputs (Phase 56+).
 *
 * Calls an OpenAI-compatible chat completion endpoint to generate
 * human-readable summaries of semantic analysis results.
 *
 * Configuration (via environment variables or `gitsema config set`):
 *   GITSEMA_LLM_URL   — base URL of the OpenAI-compatible API (required)
 *   GITSEMA_LLM_MODEL — model name (default: gpt-4o-mini)
 *   GITSEMA_API_KEY   — Bearer token (reused from embedding config, optional)
 *
 * Falls back gracefully when GITSEMA_LLM_URL is not configured.
 */

import type { EvolutionEntry } from '../search/evolution.js'
import type { SecurityFinding } from '../search/securityScan.js'
import type { ClusterReport } from '../search/clustering.js'
import type { SearchResult } from '../models/types.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Resolve and validate the LLM base URL from env. */
function resolveLlmUrl(): { parsedUrl: URL; model: string; apiKey: string } | { error: string } {
  const llmUrl = process.env.GITSEMA_LLM_URL
  if (!llmUrl) {
    return { error: '(LLM narration unavailable — set GITSEMA_LLM_URL or run: gitsema config set llmUrl <url>)' }
  }
  let parsedUrl: URL
  try {
    parsedUrl = new URL(llmUrl)
  } catch {
    return { error: `(LLM narration unavailable — GITSEMA_LLM_URL is not a valid URL: ${llmUrl})` }
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { error: '(LLM narration unavailable — GITSEMA_LLM_URL must use http or https protocol)' }
  }
  return {
    parsedUrl,
    model: process.env.GITSEMA_LLM_MODEL ?? 'gpt-4o-mini',
    apiKey: process.env.GITSEMA_API_KEY ?? '',
  }
}

/** Call the chat completion endpoint with a prompt. */
async function callLlm(parsedUrl: URL, model: string, apiKey: string, prompt: string, maxTokens = 300): Promise<string> {
  const endpoint = new URL('/v1/chat/completions', parsedUrl).toString()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  })
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`HTTP ${response.status} — ${errText.slice(0, 100)}`)
  }
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }
  if (data.error) throw new Error(data.error.message ?? 'unknown error')
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('empty response from LLM')
  return content
}

// ---------------------------------------------------------------------------
// narrateEvolution — file semantic drift timeline
// ---------------------------------------------------------------------------

export async function narrateEvolution(
  filePath: string,
  entries: EvolutionEntry[],
  threshold: number,
): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

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
    return await callLlm(parsedUrl, model, apiKey, prompt)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateClusters — k-means cluster report
// ---------------------------------------------------------------------------

export async function narrateClusters(report: ClusterReport): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const clusterLines = report.clusters.map((c, i) =>
    `Cluster ${i + 1} (${c.size} blobs): label="${c.label}" keywords=[${c.topKeywords.slice(0, 5).join(', ')}] paths=[${c.representativePaths.slice(0, 3).join(', ')}]`,
  )

  const prompt = `You are a software architecture analyst. Given the semantic cluster analysis below (${report.clusters.length} clusters, ${report.totalBlobs} total blobs), write a 2-4 sentence summary of the codebase structure. Highlight the main architectural concerns, any suspicious clusters, and how well the code appears to be organized.

${clusterLines.join('\n')}

Provide a concise narrative summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateSecurityFindings — security scan results
// ---------------------------------------------------------------------------

export async function narrateSecurityFindings(findings: SecurityFinding[]): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const high = findings.filter((f) => f.confidence === 'high')
  const medium = findings.filter((f) => f.confidence === 'medium')
  const findingLines = findings.slice(0, 20).map((f) =>
    `[${f.patternName}] confidence=${f.confidence} score=${f.score.toFixed(3)} path=${f.paths[0] ?? f.blobHash.slice(0, 8)}${f.heuristicMatches?.length ? ` heuristic="${f.heuristicMatches[0].slice(0, 60)}"` : ''}`,
  )

  const prompt = `You are a security engineer reviewing the output of a semantic security scan. The scanner found ${findings.length} potential findings (${high.length} high-confidence, ${medium.length} medium-confidence). Write a 2-4 sentence triage summary: which findings look most critical, what types of vulnerabilities dominate, and what areas of the codebase appear most at risk.

Findings:
${findingLines.join('\n')}

Note: these are similarity scores, not confirmed vulnerabilities. Focus on relative risk and areas to prioritize for manual review.

Provide a concise triage summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt, 350)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateSearchResults — semantic search results
// ---------------------------------------------------------------------------

export async function narrateSearchResults(query: string, results: SearchResult[]): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const resultLines = results.slice(0, 15).map((r) =>
    `score=${r.score.toFixed(3)}  path=${r.paths?.[0] ?? r.blobHash.slice(0, 8)}`,
  )

  const prompt = `You are a code search analyst. A developer searched for "${query}" and got ${results.length} semantic matches. In 2-3 sentences, summarize what these results suggest about the codebase: which areas are most related to the query, and what patterns or concentrations do you notice?

Top results:
${resultLines.join('\n')}

Provide a concise summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt, 250)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}
