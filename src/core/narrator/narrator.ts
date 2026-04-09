/**
 * Narrator core — git log parsing, event classification, and LLM summarisation.
 *
 * All content is redacted before being sent to the LLM provider.
 * Output always includes commit hash citations for auditability.
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import type { CommitEvent, NarrateCommandOptions, ExplainCommandOptions, NarrationResult } from './types.js'
import { redactAll } from './redact.js'
import type { NarratorProvider } from './types.js'
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Git log streaming
// ---------------------------------------------------------------------------

const MAX_COMMITS_DEFAULT = 500

/**
 * Stream commits from git log as an array of CommitEvent records.
 * Content is NOT redacted here — callers must redact before sending to LLM.
 */
export function fetchCommitEvents(opts: {
  since?: string
  until?: string
  range?: string
  maxCommits?: number
  cwd?: string
}): CommitEvent[] {
  const { since, until, range, maxCommits = MAX_COMMITS_DEFAULT, cwd = process.cwd() } = opts

  // Build git log command
  const parts: string[] = [
    'git', 'log',
    `--max-count=${maxCommits}`,
    '--format=%H%x1F%ai%x1F%an%x1F%s%x1F%b%x1E',
  ]

  if (range) {
    parts.push(range)
  } else {
    if (since) parts.push(`--since="${since}"`)
    if (until) parts.push(`--until="${until}"`)
  }

  let raw: string
  try {
    raw = execSync(parts.join(' '), { cwd, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' })
  } catch (err) {
    logger.warn(`[narrator] git log failed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }

  const events: CommitEvent[] = []
  for (const record of raw.split('\x1E')) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const [hash, date, authorName, subject, ...bodyParts] = trimmed.split('\x1F')
    if (!hash || !subject) continue
    const body = bodyParts.join('\x1F').trim()
    events.push({
      hash: hash.trim(),
      date: date?.trim() ?? '',
      authorName: authorName?.trim() ?? '',
      subject: subject.trim(),
      body,
      tags: classifyEvent(subject, body),
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

const BUGFIX_RE = /\b(fix|bug|error|crash|revert|hotfix|patch|regression|issue)\b/i
const SECURITY_RE = /\b(cve|vuln|sanitize|security|auth|xss|sqli|injection|leak|privilege)\b/i
const DEPS_RE = /\b(bump|upgrade|update|dependency|deps|dependabot|renovate)\b/i
const PERF_RE = /\b(perf|performance|faster|optimize|speed|memory|cpu|latency)\b/i
const OPS_RE = /\b(ci|cd|deploy|release|docker|k8s|kubernetes|helm|infra|pipeline)\b/i
const FEAT_RE = /\b(feat|feature|add|implement|introduce|new|support)\b/i

function classifyEvent(subject: string, body: string): string[] {
  const text = `${subject} ${body}`
  const tags: string[] = []
  if (BUGFIX_RE.test(text)) tags.push('bugfix')
  if (SECURITY_RE.test(text)) tags.push('security')
  if (DEPS_RE.test(text)) tags.push('deps')
  if (PERF_RE.test(text)) tags.push('performance')
  if (OPS_RE.test(text)) tags.push('ops')
  if (FEAT_RE.test(text)) tags.push('feature')
  if (tags.length === 0) tags.push('other')
  return tags
}

// ---------------------------------------------------------------------------
// Focus filtering
// ---------------------------------------------------------------------------

function filterByFocus(events: CommitEvent[], focus: string): CommitEvent[] {
  if (focus === 'all') return events
  return events.filter((e) => e.tags.includes(focus))
}

// ---------------------------------------------------------------------------
// Map-reduce summarisation
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100

function buildBatchSummaryPrompt(events: CommitEvent[], opts: { focus: string; batchIndex: number }): string {
  const lines = events.map((e) =>
    `[${e.hash.slice(0, 8)}] ${e.date.slice(0, 10)} ${e.authorName}: ${e.subject}`,
  )
  return (
    `You are summarizing git commit history for a software project.\n` +
    `Focus: ${opts.focus}. Batch ${opts.batchIndex + 1}.\n` +
    `Summarize the following commits in 2-3 sentences. Cite commit hashes in square brackets.\n\n` +
    lines.join('\n')
  )
}

function buildFinalNarrativePrompt(batchSummaries: string[], events: CommitEvent[], focus: string): string {
  const topCommits = events.slice(0, 10).map((e) =>
    `[${e.hash.slice(0, 8)}] ${e.subject}`,
  ).join('\n')

  return (
    `You are writing a development history narrative for a software project.\n` +
    `Focus: ${focus}. Total commits: ${events.length}.\n\n` +
    `Batch summaries:\n${batchSummaries.join('\n\n')}\n\n` +
    `Notable commits:\n${topCommits}\n\n` +
    `Write a concise narrative (3-5 paragraphs) that:\n` +
    `1. States the time range and total commit count.\n` +
    `2. Identifies the main themes.\n` +
    `3. Highlights notable commits with their hashes.\n` +
    `4. Notes any risks or unknowns (labeled as inference).\n` +
    `Cite commit hashes in square brackets like [abc123de].`
  )
}

async function summariseBatch(
  events: CommitEvent[],
  batchIndex: number,
  focus: string,
  provider: NarratorProvider,
): Promise<string> {
  const userPrompt = buildBatchSummaryPrompt(events, { focus, batchIndex })
  const res = await provider.narrate({ systemPrompt: 'You are a concise code history analyst.', userPrompt, maxTokens: 300 })
  return res.prose
}

// ---------------------------------------------------------------------------
// Main narrate function
// ---------------------------------------------------------------------------

export async function runNarrate(
  provider: NarratorProvider,
  opts: NarrateCommandOptions,
): Promise<NarrationResult> {
  const focus = opts.focus ?? 'all'
  const format = opts.format ?? 'md'

  // 1. Fetch commits
  const allEvents = fetchCommitEvents({
    since: opts.since,
    until: opts.until,
    range: opts.range,
    maxCommits: opts.maxCommits,
  })

  // 2. Filter by focus
  const events = filterByFocus(allEvents, focus)

  if (events.length === 0) {
    return {
      prose: '(No commits matched the specified criteria.)',
      commitCount: 0,
      citations: [],
      redactedFields: [],
      llmEnabled: false,
      format,
    }
  }

  // 3. Batch + map-reduce
  const batches: CommitEvent[][] = []
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    batches.push(events.slice(i, i + BATCH_SIZE))
  }

  const batchSummaries: string[] = []
  const allRedacted: string[] = []

  for (let i = 0; i < batches.length; i++) {
    const summary = await summariseBatch(batches[i], i, focus, provider)
    batchSummaries.push(summary)
  }

  // 4. Final narrative
  const finalPrompt = buildFinalNarrativePrompt(batchSummaries, events, focus)
  const { texts: finalTexts, firedPatterns } = redactAll([finalPrompt])
  const redactedFinal = finalTexts[0]
  for (const p of firedPatterns) { if (!allRedacted.includes(p)) allRedacted.push(p) }

  const finalRes = await provider.narrate({
    systemPrompt: 'You are writing a development history narrative. Be factual, cite commit hashes.',
    userPrompt: redactedFinal,
    maxTokens: 600,
  })

  const citations = events.slice(0, 20).map((e) => e.hash)

  return {
    prose: finalRes.prose,
    commitCount: events.length,
    citations,
    redactedFields: [...allRedacted, ...finalRes.redactedFields],
    llmEnabled: finalRes.llmEnabled,
    format,
  }
}

// ---------------------------------------------------------------------------
// Explain (error/bug history)
// ---------------------------------------------------------------------------

export async function runExplain(
  provider: NarratorProvider,
  topic: string,
  opts: ExplainCommandOptions,
): Promise<NarrationResult> {
  const format = opts.format ?? 'md'

  // 1. Fetch commits
  const allEvents = fetchCommitEvents({
    since: opts.since,
    until: opts.until,
    maxCommits: 500,
  })

  // 2. Find relevant commits (keyword match on subject + body)
  const keywords = topic.toLowerCase().split(/\s+/)
  const relevant = allEvents.filter((e) => {
    const text = `${e.subject} ${e.body}`.toLowerCase()
    return keywords.some((kw) => text.includes(kw))
  })

  // 3. Optional: include user-provided log file
  let logContent = ''
  if (opts.log && existsSync(opts.log)) {
    try {
      logContent = readFileSync(opts.log, 'utf8').slice(0, 8000) // cap at 8KB
    } catch {
      // ignore
    }
  }

  // 4. Build explain prompt
  const commitLines = relevant.slice(0, 30).map((e) =>
    `[${e.hash.slice(0, 8)}] ${e.date.slice(0, 10)} ${e.subject}`,
  )
  const userPrompt = [
    `Topic: "${topic}"`,
    `Found ${relevant.length} related commits (showing up to 30).`,
    relevant.length > 0 ? `\nCommit timeline:\n${commitLines.join('\n')}` : '\nNo related commits found.',
    logContent ? `\nError log excerpt:\n${logContent.slice(0, 2000)}` : '',
    `\nPlease provide:\n1. A timeline of when this issue appeared.\n2. Likely introduction commit(s) with hashes.\n3. Any fix attempts with commit hashes.\n4. Current status (resolved / ongoing).\nLabel inferences clearly. Cite commit hashes in square brackets.`,
  ].filter(Boolean).join('\n')

  const { texts: explainTexts, firedPatterns } = redactAll([userPrompt])
  const redactedPrompt = explainTexts[0]

  const res = await provider.narrate({
    systemPrompt: 'You are a software incident analyst. Be factual and cite commit hashes for every claim.',
    userPrompt: redactedPrompt,
    maxTokens: 512,
  })

  const citations = relevant.slice(0, 20).map((e) => e.hash)

  return {
    prose: res.prose,
    commitCount: relevant.length,
    citations,
    redactedFields: [...firedPatterns, ...res.redactedFields],
    llmEnabled: res.llmEnabled,
    format,
  }
}
