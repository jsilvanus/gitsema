import { writeFileSync, readFileSync } from 'node:fs'
import { computeSemanticDiff } from '../../core/search/semanticDiff.js'
import { computeImpact } from '../../core/search/impact.js'
import { computeConceptChangePoints } from '../../core/search/changePoints.js'
import type { ConceptChangePoint } from '../../core/search/changePoints.js'
import { computeExperts } from '../../core/search/experts.js'
import { getTextProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { parsePositiveInt } from '../../utils/parse.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface PrReportOptions {
  ref1?: string
  ref2?: string
  file?: string
  query?: string
  top?: string
  since?: string
  until?: string
  dump?: string | boolean
  out?: string[]
}

export async function prReportCommand(options: PrReportOptions): Promise<void> {
  const ref1 = options.ref1 ?? 'HEAD~1'
  const ref2 = options.ref2 ?? 'HEAD'
  const query = options.query ?? ''
  const topK = options.top ? parsePositiveInt(options.top, '--top') : 10

  let since: number | undefined
  let until: number | undefined
  if (options.since) since = parseDateArg(options.since)
  if (options.until) until = parseDateArg(options.until)

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    ref1,
    ref2,
  }

  // ── Build embedding provider (needed for semantic diff, impact, change-points) ──
  let textProvider: ReturnType<typeof getTextProvider> | undefined
  if (options.file || query) {
    try {
      textProvider = getTextProvider()
    } catch {
      // Provider unavailable — sections that need it will gracefully skip
    }
  }

  // ── Semantic diff (if --file provided) ────────────────────────────────────
  if (options.file && textProvider) {
    try {
      // Embed file *content* (not the path string) so the semantic diff topic
      // reflects the actual changes in the file, not just its name.
      let fileContent: string
      try {
        fileContent = readFileSync(options.file, 'utf8')
      } catch {
        fileContent = options.file // Fall back to path if file unreadable (e.g. deleted in diff)
      }
      const queryEmbedding = await embedQuery(textProvider, fileContent)
      const diff = computeSemanticDiff(queryEmbedding, options.file, ref1, ref2, topK)
      report.semanticDiff = {
        ref1: diff.ref1,
        ref2: diff.ref2,
        topic: diff.topic,
        gained: diff.gained.length,
        lost: diff.lost.length,
        stable: diff.stable.length,
      }
    } catch (err) {
      report.semanticDiff = { error: String(err) }
    }
  }

  // ── Impacted modules (if --file provided) ────────────────────────────────
  if (options.file && textProvider) {
    try {
      const impactReport = await computeImpact(options.file, textProvider, { topK })
      report.impactedModules = impactReport.results.map((r) => ({
        path: r.paths[0] ?? '(unknown)',
        score: r.score,
      }))
    } catch (err) {
      report.impactedModules = { error: String(err) }
    }
  }

  // ── Change-point highlights (if --query) ──────────────────────────────────
  if (query && textProvider) {
    try {
      const queryEmbedding = await embedQuery(textProvider, query)
      const cpReport = computeConceptChangePoints(query, queryEmbedding, { topK, topPoints: 5 })
      report.changePoints = cpReport.points
    } catch (err) {
      report.changePoints = { error: String(err) }
    }
  }

  // ── Reviewer suggestions (experts) ───────────────────────────────────────
  try {
    const experts = computeExperts({ topN: 5, since, until, minBlobs: 1, topClusters: 3 })
    report.reviewerSuggestions = experts
  } catch (err) {
    report.reviewerSuggestions = { error: String(err) }
  }

  // ── Output ────────────────────────────────────────────────────────────────
  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: undefined })
  const jsonSink = getSink(sinks, 'json')

  if (jsonSink) {
    const json = JSON.stringify(report, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`PR report written to ${jsonSink.file}`)
    } else {
      console.log(json)
      return
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  // Human-readable output
  console.log(`\n=== Semantic PR Report: ${ref1}..${ref2} ===\n`)

  if (report.semanticDiff && options.file) {
    const diff = report.semanticDiff as { gained?: number; lost?: number; stable?: number; error?: string }
    console.log(`Semantic diff for ${options.file}:`)
    if (diff.error) {
      console.log(`  (unavailable: ${diff.error})`)
    } else {
      console.log(`  Gained: ${diff.gained ?? 0}  Lost: ${diff.lost ?? 0}  Stable: ${diff.stable ?? 0}`)
    }
    console.log()
  }

  if (report.impactedModules && options.file) {
    const impact = report.impactedModules as Array<{ path?: string; score?: number }>
    if (Array.isArray(impact) && impact.length > 0) {
      console.log(`Impacted modules (top ${impact.length}):`)
      for (const m of impact) {
        const score = typeof m.score === 'number' ? `  score=${m.score.toFixed(3)}` : ''
        console.log(`  · ${m.path ?? '(unknown)'}${score}`)
      }
    }
    console.log()
  }

  if (report.changePoints && query) {
    const cps = report.changePoints as ConceptChangePoint[]
    if (Array.isArray(cps) && cps.length > 0) {
      console.log('Change-point highlights:')
      for (const cp of cps.slice(0, 3)) {
        console.log(`  · ${cp.before.date} → ${cp.after.date}  Δ=${cp.distance.toFixed(4)}  ${cp.before.commit.slice(0, 7)}`)
      }
    }
    console.log()
  }

  const reviewers = report.reviewerSuggestions as Array<{ authorName?: string; blobCount?: number }>
  if (Array.isArray(reviewers) && reviewers.length > 0) {
    console.log('Suggested reviewers:')
    for (const r of reviewers) {
      console.log(`  · ${r.authorName} (${r.blobCount} blob(s))`)
    }
    console.log()
  }
}
