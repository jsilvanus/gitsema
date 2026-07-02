/**
 * Insights tools (Phase 148 — triage of remaining zero-HTTP/MCP-exposure CLI
 * commands). Wraps commands that had a CLI surface but no MCP tool at all:
 * `bisect`, `refactor-candidates`, `lifecycle`, `cherry-pick-suggest`,
 * `file-diff`, `pr-report`, `regression-gate`, `code-review`, `heatmap`,
 * `map`. Each handler is a thin adapter over the same `src/core/search/*`
 * functions the CLI commands call — no business logic is duplicated here.
 *
 * See docs/parity.md §1 for the bucket (a)/(b)/(c) triage of all 13
 * commands the Phase 148 audit flagged; `diff`, `ci-diff`,
 * `cross-repo-similarity`, and `project` were judged redundant or
 * CLI-shaped and are intentionally NOT exposed here.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTool } from '../registerTool.js'
import { getTextProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import { computeSemanticBisect } from '../../core/search/semanticBisect.js'
import { computeRefactorCandidates } from '../../core/search/refactorCandidates.js'
import { computeConceptLifecycle } from '../../core/search/conceptLifecycle.js'
import { suggestCherryPicks } from '../../core/search/cherryPick.js'
import { computeDiff } from '../../core/search/temporal/evolution.js'
import { computeSemanticDiff } from '../../core/search/semanticDiff.js'
import { computeImpact } from '../../core/search/impact.js'
import { computeConceptChangePoints } from '../../core/search/temporal/changePoints.js'
import { computeExperts } from '../../core/search/experts.js'
import { computeRegressionGate, type RegressionGateQuery } from '../../core/search/regressionGate.js'
import { parseDiff, computeCodeReview } from '../../core/search/codeReview.js'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { parseLens } from '../../cli/lib/lens.js'

export function registerInsightsTools(server: McpServer) {
  // semantic_bisect
  registerTool(
    server,
    'semantic_bisect',
    'Binary search over commit history to find where a concept diverged from a "good" baseline (semantic git bisect).',
    {
      good_ref: z.string().describe('A git ref known to be "good" (baseline) — branch, tag, commit hash, or date.'),
      bad_ref: z.string().describe('A git ref known to be "bad" (where the concept has drifted).'),
      query: z.string().describe('Natural-language concept to track.'),
      top_k: z.number().int().min(1).max(50).optional().default(20).describe('Top-K blobs used to compute the concept centroid at each step.'),
      max_steps: z.number().int().min(1).max(25).optional().default(10).describe('Maximum bisect steps.'),
    },
    async ({ good_ref, bad_ref, query, top_k, max_steps }, { embed }) => {
      const provider = getTextProvider()
      const eRes = await embed(provider, query, 'Error embedding query')
      if (!eRes.ok) return eRes.resp
      const result = computeSemanticBisect(eRes.embedding!, query, good_ref, bad_ref, { topK: top_k, maxSteps: max_steps })
      const lines = [
        `Semantic bisect: "${result.query}"`,
        `  good: ${result.goodRef}  →  bad: ${result.badRef}`,
        `  Culprit: ${result.culpritRef}  (max shift ${result.maxShift.toFixed(3)})`,
        '',
        ...result.steps.map((s) => `  ${new Date(s.timestamp * 1000).toISOString().slice(0, 10)}  blobs=${s.blobCount}  dist=${s.distanceFromGood.toFixed(3)}`),
      ]
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // refactor_candidates
  registerTool(
    server,
    'refactor_candidates',
    'Find pairs of symbols/chunks/files that are semantically similar enough to be refactoring candidates.',
    {
      threshold: z.number().min(0).max(1).optional().default(0.88).describe('Cosine similarity threshold for a candidate pair.'),
      top_k: z.number().int().min(1).max(50).optional().default(50).describe('Maximum pairs to return.'),
      level: z.enum(['symbol', 'chunk', 'file']).optional().default('symbol').describe('Search granularity.'),
    },
    async ({ threshold, top_k, level }) => {
      const report = computeRefactorCandidates({ threshold, topK: top_k, level })
      const lines = [
        `Refactoring candidates (level=${report.level}, threshold=${report.threshold}, scanned=${report.totalScanned})`,
        '',
        ...report.pairs.map((p) => {
          const a = p.nameA ? `${p.pathA}::${p.nameA}` : p.pathA
          const b = p.nameB ? `${p.pathB}::${p.nameB}` : p.pathB
          return `  ${p.similarity.toFixed(3)}  ${a}  ↔  ${b}`
        }),
      ]
      if (report.pairs.length === 0) lines.push('  No candidates found above threshold.')
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // concept_lifecycle
  registerTool(
    server,
    'concept_lifecycle',
    'Analyze the lifecycle stages (born → growing → mature → declining → dead) of a semantic concept across Git history.',
    {
      query: z.string().describe('Natural-language concept to trace.'),
      steps: z.number().int().min(2).max(50).optional().default(10).describe('Number of time windows to sample.'),
      threshold: z.number().min(0).max(1).optional().default(0.7).describe('Cosine similarity threshold for a "match".'),
    },
    async ({ query, steps, threshold }, { embed }) => {
      const provider = getTextProvider()
      const eRes = await embed(provider, query, 'Error embedding query')
      if (!eRes.ok) return eRes.resp
      const result = computeConceptLifecycle(eRes.embedding!, query, { steps, threshold })
      const lines = [
        `Concept lifecycle: "${result.query}"`,
        `  Current stage: ${result.currentStage}`,
        `  Peak: ${result.peakCount} matches on ${new Date(result.peakTimestamp * 1000).toISOString().slice(0, 10)}`,
        result.isDead ? '  Concept appears to be dead (no recent matches)' : '',
        '',
        ...result.points.map((p) => `  ${p.date}  count=${p.matchCount}  stage=${p.stage}`),
      ].filter(Boolean)
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // cherry_pick_suggest
  registerTool(
    server,
    'cherry_pick_suggest',
    'Suggest commits to cherry-pick based on semantic similarity of their commit messages to a query.',
    {
      query: z.string().describe('Natural-language description of the change to find.'),
      top_k: z.number().int().min(1).max(25).optional().default(10).describe('Number of results to return.'),
    },
    async ({ query, top_k }, { embed }) => {
      const provider = getTextProvider()
      const eRes = await embed(provider, query, 'Error embedding query')
      if (!eRes.ok) return eRes.resp
      const results = await suggestCherryPicks(eRes.embedding!, { topK: top_k, model: provider.model })
      if (results.length === 0) return { content: [{ type: 'text', text: 'No cherry-pick suggestions found.' }] }
      const lines = [`Cherry-pick suggestions for: "${query}"`, '']
      results.forEach((r, idx) => lines.push(`${idx + 1}. ${r.score.toFixed(3)}  ${r.commitHash.slice(0, 7)}  ${r.message}`))
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // file_diff
  registerTool(
    server,
    'file_diff',
    'Compute the semantic diff (cosine distance) between two versions of a single file at two git refs.',
    {
      ref1: z.string().describe('Earlier git ref (branch, tag, commit hash, or date).'),
      ref2: z.string().describe('Later git ref.'),
      path: z.string().describe('File path relative to the repo root.'),
      neighbors: z.number().int().min(0).max(10).optional().default(0).describe('Number of nearest-neighbour blobs to show for each version.'),
    },
    async ({ ref1, ref2, path, neighbors }) => {
      const result = await computeDiff(ref1, ref2, path, { neighbors })
      const lines = [
        `Semantic diff: ${path}`,
        `  ref1: ${result.ref1}  blob: ${result.blobHash1 ?? '(not found)'}`,
        `  ref2: ${result.ref2}  blob: ${result.blobHash2 ?? '(not found)'}`,
      ]
      if (result.cosineDistance === null) {
        lines.push('  One or both versions are not present in the index, or embeddings are missing.')
      } else {
        lines.push(`  Cosine distance: ${result.cosineDistance.toFixed(4)}`)
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // pr_report
  registerTool(
    server,
    'pr_report',
    'Compose a semantic PR report: diff summary and impacted modules for a file, change-point highlights for a concept query, and suggested reviewers.',
    {
      ref1: z.string().optional().default('HEAD~1').describe('Base ref.'),
      ref2: z.string().optional().default('HEAD').describe('Head ref.'),
      file: z.string().optional().describe('File path to analyze for semantic diff and impact.'),
      query: z.string().optional().describe('Concept query for change-point highlights.'),
      top: z.number().int().min(1).max(25).optional().default(10).describe('Result limit per section.'),
    },
    async ({ ref1, ref2, file, query, top }, { embed }) => {
      const report: Record<string, unknown> = { ref1, ref2 }
      const provider = (file || query) ? getTextProvider() : undefined

      if (file && provider) {
        try {
          const eRes = await embed(provider, file, 'Error embedding file content')
          if (eRes.ok) {
            const diff = computeSemanticDiff(eRes.embedding!, file, ref1, ref2, top)
            report.semanticDiff = { gained: diff.gained.length, lost: diff.lost.length, stable: diff.stable.length }
          }
        } catch (err) {
          report.semanticDiff = { error: err instanceof Error ? err.message : String(err) }
        }
        try {
          const impactReport = await computeImpact(file, provider, { topK: top })
          report.impactedModules = impactReport.results.map((r) => ({ path: r.paths[0] ?? null, score: r.score }))
        } catch (err) {
          report.impactedModules = { error: err instanceof Error ? err.message : String(err) }
        }
      }

      if (query && provider) {
        try {
          const eRes = await embed(provider, query, 'Error embedding query')
          if (eRes.ok) {
            const cpReport = computeConceptChangePoints(query, eRes.embedding!, { topK: top, topPoints: 5 })
            report.changePoints = cpReport.points.map((p) => ({
              distance: p.distance,
              before: { commit: p.before.commit, date: p.before.date },
              after: { commit: p.after.commit, date: p.after.date },
            }))
          }
        } catch (err) {
          report.changePoints = { error: err instanceof Error ? err.message : String(err) }
        }
      }

      try {
        report.reviewerSuggestions = computeExperts({ topN: 5, minBlobs: 1, topClusters: 3 })
          .map((e) => ({ authorName: e.authorName, authorEmail: e.authorEmail, blobCount: e.blobCount }))
      } catch (err) {
        report.reviewerSuggestions = { error: err instanceof Error ? err.message : String(err) }
      }

      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] }
    },
  )

  // regression_gate
  registerTool(
    server,
    'regression_gate',
    'CI policy gate: compares each concept query\'s top-match score between two git refs and fails if the drift exceeds its threshold. Companion to `policy_check` for pre-merge concept-drift checks.',
    {
      base: z.string().optional().default('main').describe('Base ref to compare from.'),
      head: z.string().optional().default('HEAD').describe('Head ref to compare to.'),
      queries: z.array(z.object({
        query: z.string(),
        threshold: z.number().min(0).max(2).optional(),
      })).min(1).describe('Concept queries to check, each with an optional per-query drift threshold.'),
      threshold: z.number().min(0).max(2).optional().default(0.15).describe('Default max allowed cosine drift (used when a query has no per-query threshold).'),
      top_k: z.number().int().min(1).max(50).optional().default(10).describe('Top-k results to compare per query.'),
    },
    async ({ base, head, queries, threshold, top_k }, { embed }) => {
      const provider = getTextProvider()
      const embeddedQueries: RegressionGateQuery[] = []
      for (const q of queries) {
        const eRes = await embed(provider, q.query, `Error embedding query "${q.query}"`)
        if (!eRes.ok) return eRes.resp
        embeddedQueries.push({ query: q.query, embedding: eRes.embedding!, threshold: q.threshold ?? threshold })
      }
      const report = await computeRegressionGate(embeddedQueries, { baseRef: base, headRef: head, topK: top_k })
      const lines = [
        `Regression gate: ${base}..${head}`,
        report.allPassed ? '✅ All concepts within drift threshold — gate PASSED' : '❌ One or more concepts drifted beyond threshold — gate FAILED',
        '',
        ...report.results.map((r) => `  ${r.passed ? '✓' : '✗'} "${r.query}"  base=${r.baseScore.toFixed(4)} head=${r.headScore.toFixed(4)} drift=${r.drift.toFixed(4)} (threshold ${r.threshold})`),
      ]
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // code_review
  registerTool(
    server,
    'code_review',
    'Semantic code review: given a unified diff, find historical analogues for changed code and flag a regression-risk heuristic per file.',
    {
      diff_text: z.string().describe('Unified diff text (e.g. output of `git diff`).'),
      top_k: z.number().int().min(1).max(25).optional().default(5).describe('Top analogues per file.'),
      threshold: z.number().min(0).max(1).optional().default(0.75).describe('Minimum similarity score for an analogue to be reported.'),
      lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('semantic').describe('Whether to enrich results with structural (call-graph/co-change) context.'),
    },
    async ({ diff_text, top_k, threshold, lens }) => {
      const hunks = parseDiff(diff_text)
      if (hunks.length === 0) return { content: [{ type: 'text', text: 'No changed files detected in diff.' }] }

      const provider = getTextProvider()
      const parsedLens = parseLens(lens, 'semantic')
      const graph = parsedLens !== 'semantic' ? getCachedStorageProfile(process.cwd()).graph : undefined

      const reviews = await computeCodeReview(hunks, provider, { topK: top_k, threshold, graph })
      if (reviews.length === 0) return { content: [{ type: 'text', text: 'No changed files with added code to review.' }] }

      const lines = [`Semantic code review — files reviewed: ${hunks.length}  |  threshold: ${threshold}`, '']
      for (const r of reviews) {
        lines.push(`${r.file}  (regression risk: ${r.regressionRisk})`)
        if (r.analogues.length > 0) {
          for (const a of r.analogues) lines.push(`    ${a.score.toFixed(4)}  ${a.path}`)
        } else {
          lines.push('    No historical analogues found above threshold.')
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // activity_heatmap
  registerTool(
    server,
    'activity_heatmap',
    'Semantic activity heatmap: count of distinct blob changes per time period (week or month).',
    {
      period: z.enum(['week', 'month']).optional().default('week').describe('Aggregation period.'),
    },
    async ({ period }) => {
      const { rawDb } = getActiveSession()
      const fmt = period === 'month' ? `'%Y-%m'` : `'%Y-%W'`
      const rows = rawDb.prepare(
        `SELECT strftime(${fmt}, datetime(c.timestamp, 'unixepoch')) AS period, COUNT(DISTINCT b.blob_hash) AS cnt
         FROM blob_commits b JOIN commits c ON b.commit_hash = c.commit_hash
         GROUP BY period ORDER BY period`,
      ).all() as Array<{ period: string; cnt: number }>
      if (rows.length === 0) return { content: [{ type: 'text', text: 'No commit/blob activity indexed yet.' }] }
      const lines = [`Activity heatmap (${period}):`, '', ...rows.slice(-52).map((r) => `  ${r.period}: ${r.cnt}`)]
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // semantic_map
  registerTool(
    server,
    'semantic_map',
    'Semantic codebase map: the most recent k-means cluster snapshot (labels, sizes, representative paths) and blob-assignment counts per cluster — the data source behind `gitsema tools serve --ui`\'s cluster overlay.',
    {},
    async () => {
      const { rawDb } = getActiveSession()
      const clusters = rawDb.prepare('SELECT id, label, size, representative_paths FROM blob_clusters').all() as Array<{ id: number; label: string; size: number; representative_paths: string | null }>
      if (clusters.length === 0) return { content: [{ type: 'text', text: 'No cluster snapshot found — run `gitsema clusters` first.' }] }
      const assignmentRows = rawDb.prepare('SELECT cluster_id, COUNT(*) AS cnt FROM cluster_assignments GROUP BY cluster_id').all() as Array<{ cluster_id: number; cnt: number }>
      const assignmentCounts: Record<number, number> = {}
      for (const r of assignmentRows) assignmentCounts[r.cluster_id] = r.cnt
      const lines = ['Semantic map (cluster snapshot):', '']
      for (const c of clusters) {
        const paths = c.representative_paths ? (JSON.parse(c.representative_paths) as string[]).slice(0, 3).join(', ') : ''
        lines.push(`  [${c.id}] ${c.label}  size=${c.size}  assigned=${assignmentCounts[c.id] ?? 0}  paths: ${paths}`)
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )
}
