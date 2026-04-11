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

import type { EvolutionEntry, DiffResult } from '../search/evolution.js'
import type { SecurityFinding } from '../search/securityScan.js'
import type { ClusterReport, TemporalClusterReport, ClusterTimelineReport } from '../search/clustering.js'
import type { SearchResult } from '../models/types.js'
import type { ConceptChangePointReport, FileChangePointReport } from '../search/changePoints.js'
import type { HealthSnapshot } from '../search/healthTimeline.js'
import type { ConceptLifecycleResult } from '../search/conceptLifecycle.js'

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
  const timeoutMs = (() => {
    const raw = process.env.GITSEMA_LLM_TIMEOUT
    if (raw) { const n = parseInt(raw, 10); if (Number.isFinite(n) && n > 0) return n * 1000 }
    return 30_000
  })()
  const maxRetries = (() => {
    const raw = process.env.GITSEMA_LLM_RETRIES
    if (raw) { const n = parseInt(raw, 10); if (Number.isFinite(n) && n >= 0) return n }
    return 1
  })()

  async function attempt(attemptsLeft: number): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(endpoint, {
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
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      const isTimeout = e instanceof Error && e.name === 'AbortError'
      if (isTimeout && attemptsLeft > 0) {
        return attempt(attemptsLeft - 1)
      }
      throw isTimeout
        ? new Error(`LLM request timed out after ${timeoutMs / 1000}s (degraded mode)`)
        : e
    }
    clearTimeout(timer)
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

  return attempt(maxRetries)
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

// ---------------------------------------------------------------------------
// narrateClusterDiff — temporal cluster diff (ref1 → ref2)
// ---------------------------------------------------------------------------

export async function narrateClusterDiff(report: TemporalClusterReport): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const active = report.changes.filter((c) => c.newBlobs > 0 || c.removedBlobs > 0 || c.inflows.length > 0 || c.outflows.length > 0)
  const topMoves = active.slice(0, 6).map((c) => {
    const label = c.afterCluster?.label ?? c.beforeCluster?.label ?? '?'
    const inflowCount = c.inflows.reduce((s, f) => s + f.count, 0)
    const outflowCount = c.outflows.reduce((s, f) => s + f.count, 0)
    return `  "${label}": +${c.newBlobs} new, -${c.removedBlobs} removed, ${inflowCount} migrated-in, ${outflowCount} migrated-out`
  })

  const prompt = `You are a software architecture analyst reviewing a semantic cluster diff.
The codebase evolved from ${report.ref1} to ${report.ref2}.
Before: ${report.before.clusters.length} clusters, ${report.before.totalBlobs} blobs.
After:  ${report.after.clusters.length} clusters, ${report.after.totalBlobs} blobs.
Summary: ${report.newBlobsTotal} new blobs, ${report.removedBlobsTotal} removed, ${report.movedBlobsTotal} moved across clusters, ${report.stableBlobsTotal} stable.

Top cluster changes:
${topMoves.join('\n')}

In 2-4 sentences, describe what this diff reveals about how the codebase architecture shifted between these two points. Focus on the most significant movements and what they likely indicate.

Provide a concise narrative summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateClusterTimeline — multi-step cluster evolution
// ---------------------------------------------------------------------------

export async function narrateClusterTimeline(report: ClusterTimelineReport): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const stepLines = report.steps.map((s, i) => {
    const stats = s.stats
    const statStr = stats
      ? ` (+${stats.newBlobs} new, -${stats.removedBlobs} removed, ${stats.movedBlobs} moved)`
      : ' (baseline)'
    const topLabels = s.clusters.slice(0, 3).map((c) => `"${c.label}"`).join(', ')
    return `  Step ${i + 1} [${s.ref}] ${s.blobCount} blobs${statStr} — top clusters: ${topLabels}`
  })

  const prompt = `You are a software evolution analyst reviewing a semantic cluster timeline.
The codebase was analyzed at ${report.steps.length} checkpoints (${report.k} clusters per step).

Timeline:
${stepLines.join('\n')}

In 2-4 sentences, summarize the dominant trends in how the codebase's conceptual structure evolved over time. Note any significant acceleration or stabilization periods, and what the progression suggests about the project's development trajectory.

Provide a concise narrative summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateChangePoints — semantic concept change-points timeline
// ---------------------------------------------------------------------------

export async function narrateChangePoints(report: ConceptChangePointReport): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const pointLines = report.points.slice(0, 8).map((p, i) =>
    `  #${i + 1}  ${p.before.date} → ${p.after.date}  distance=${p.distance.toFixed(4)}  before=[${p.before.topPaths.slice(0, 2).join(', ')}]  after=[${p.after.topPaths.slice(0, 2).join(', ')}]`,
  )

  const prompt = `You are a software evolution analyst. The semantic change-point detector found ${report.points.length} major shifts in how the concept "${report.query}" is represented in the codebase.

Change points (sorted by semantic distance, largest first):
${pointLines.join('\n')}

In 2-3 sentences, summarize when and how the concept "${report.query}" changed most significantly. What do the file paths suggest about the nature of each change?

Provide a concise narrative summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt, 250)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateFileChangePoints — semantic file change-points timeline
// ---------------------------------------------------------------------------

export async function narrateFileChangePoints(filePath: string, report: FileChangePointReport): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const pointLines = report.points.slice(0, 8).map((p, i) =>
    `  #${i + 1}  ${p.before.date} → ${p.after.date}  distance=${p.distance.toFixed(4)}  before=[${p.before.commit.slice(0, 7)}]  after=[${p.after.commit.slice(0, 7)}]`,
  )

  const prompt = `You are a software evolution analyst. A semantic change-point analysis found ${report.points.length} major semantic shifts in the file "${filePath}".

Change points (sorted by distance, largest first):
${pointLines.join('\n')}

In 2-3 sentences, summarize the key inflection points in this file's history. What does the pattern of distances suggest about when and how significantly the file's purpose or implementation changed?

Provide a concise narrative summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt, 250)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateDiff — semantic file diff between two refs
// ---------------------------------------------------------------------------

export async function narrateDiff(filePath: string, result: DiffResult): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  if (result.cosineDistance === null) {
    return '(LLM narration unavailable — one or both versions are not in the index)'
  }

  const interpretation =
    result.cosineDistance < 0.05 ? 'virtually identical'
    : result.cosineDistance < 0.15 ? 'minor drift'
    : result.cosineDistance < 0.35 ? 'moderate change'
    : result.cosineDistance < 0.6 ? 'significant rewrite'
    : 'complete semantic overhaul'

  const nn1 = result.neighbors1?.slice(0, 3).map((n) => n.paths[0] ?? n.blobHash.slice(0, 8)).join(', ') ?? '(none)'
  const nn2 = result.neighbors2?.slice(0, 3).map((n) => n.paths[0] ?? n.blobHash.slice(0, 8)).join(', ') ?? '(none)'

  const prompt = `You are a code review assistant analyzing a semantic diff of the file "${filePath}" between ${result.ref1} and ${result.ref2}.

Cosine distance: ${result.cosineDistance.toFixed(4)} (${interpretation})
Nearest neighbors at ${result.ref1}: ${nn1}
Nearest neighbors at ${result.ref2}: ${nn2}

In 2-3 sentences, interpret what this semantic distance and the neighbor shift suggests about how the file's purpose or implementation changed between these two versions.

Provide a concise narrative summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt, 250)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateHealthTimeline — codebase health metrics over time
// ---------------------------------------------------------------------------

export async function narrateHealthTimeline(snapshots: HealthSnapshot[]): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const lines = snapshots.slice(0, 16).map((s) => {
    const start = new Date(s.periodStart * 1000).toISOString().slice(0, 10)
    const end = new Date(s.periodEnd * 1000).toISOString().slice(0, 10)
    return `  ${start}–${end}  active=${s.activeBlobCount}  churn=${s.semanticChurnRate.toFixed(3)}  dead=${s.deadConceptRatio.toFixed(3)}`
  })

  const prompt = `You are a software engineering analyst reviewing a codebase health timeline.
Each row shows a time period with active blob count, semantic churn rate (higher = more concept turnover), and dead concept ratio (higher = more stale/removed concepts).

Health timeline:
${lines.join('\n')}

In 2-4 sentences, summarize the overall health trajectory of this codebase. Note any concerning spikes in churn or dead concepts, periods of stability, and what the trend suggests about the project's development health.

Provide a concise narrative summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt, 300)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}

// ---------------------------------------------------------------------------
// narrateLifecycle — concept lifecycle analysis
// ---------------------------------------------------------------------------

export async function narrateLifecycle(result: ConceptLifecycleResult): Promise<string> {
  const resolved = resolveLlmUrl()
  if ('error' in resolved) return resolved.error

  const { parsedUrl, model, apiKey } = resolved

  const born = result.bornTimestamp
    ? new Date(result.bornTimestamp * 1000).toISOString().slice(0, 10)
    : 'unknown'
  const peak = new Date(result.peakTimestamp * 1000).toISOString().slice(0, 10)
  const pointLines = result.points.slice(0, 12).map((p) =>
    `  ${p.date}  stage=${p.stage}  matches=${p.matchCount}  growth=${p.growthRate.toFixed(3)}`,
  )

  const prompt = `You are a software evolution analyst reviewing the lifecycle of the concept "${result.query}".
Born: ${born}  Peak: ${peak} (${result.peakCount} matches)  Current stage: ${result.currentStage}  Dead: ${result.isDead}

Lifecycle points (${result.points.length} steps):
${pointLines.join('\n')}

In 2-4 sentences, narrate the lifecycle story of this concept in the codebase. When did it emerge, grow, and what stage is it at now? What does this lifecycle suggest about the concept's long-term importance to the project?

Provide a concise narrative summary:`

  try {
    return await callLlm(parsedUrl, model, apiKey, prompt, 300)
  } catch (e) {
    return `(LLM narration failed: ${e instanceof Error ? e.message : String(e)})`
  }
}
