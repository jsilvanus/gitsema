/**
 * HTTP routes for "insights" commands (Phase 148 — triage of remaining
 * zero-HTTP/MCP-exposure CLI commands).
 *
 * Routes (under /api/v1/insights/):
 *   POST /bisect               — semantic git bisect
 *   POST /refactor-candidates  — near-duplicate symbol/chunk/file pairs
 *   POST /lifecycle            — concept lifecycle stages over history
 *   POST /cherry-pick-suggest  — commit suggestions by message similarity
 *   POST /file-diff            — single-file semantic diff between two refs
 *   POST /pr-report            — composite PR report (diff/impact/change-points/reviewers)
 *   POST /regression-gate      — CI gate: per-query base/head drift check
 *   POST /code-review          — historical analogues + regression risk for a diff
 *   POST /heatmap              — activity heatmap by time bucket
 *   POST /map                  — cluster snapshot + blob assignments (semantic map)
 *
 * These commands had a CLI surface (and in most cases a `gitsema guide` tool)
 * but no HTTP route or MCP tool at all before this phase — see
 * docs/parity.md §1 for the full bucket (a)/(b)/(c) triage. `diff`,
 * `ci-diff`, `cross-repo-similarity`, and `project` were judged redundant or
 * CLI-shaped and are intentionally not exposed here.
 *
 * All routes here accept the CLI's `--model`/`--text-model`/`--code-model`
 * override triplet via `modelOverrideSchema` + `resolveRequestProvider()`,
 * same convention as `analysis.ts` (Phase 140).
 */

import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
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
import { modelOverrideSchema, resolveRequestProvider, ModelOverrideError } from '../lib/modelOverrides.js'

export interface InsightsRouterDeps {
  textProvider: EmbeddingProvider
}

export function insightsRouter(deps: InsightsRouterDeps): Router {
  const { textProvider } = deps
  const router = Router()

  // POST /insights/bisect
  const BisectBodySchema = z.object({
    ...modelOverrideSchema.shape,
    goodRef: z.string().min(1),
    badRef: z.string().min(1),
    query: z.string().min(1),
    topK: z.number().int().positive().max(50).optional().default(20),
    maxSteps: z.number().int().positive().max(25).optional().default(10),
  })
  router.post('/bisect', async (req, res) => {
    const parsed = BisectBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let qEmb: Embedding
    try {
      const provider = resolveRequestProvider(opts, textProvider)
      qEmb = await provider.embed(opts.query)
    } catch (err) {
      const status = err instanceof ModelOverrideError ? 400 : 502
      res.status(status).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const result = computeSemanticBisect(qEmb, opts.query, opts.goodRef, opts.badRef, { topK: opts.topK, maxSteps: opts.maxSteps })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /insights/refactor-candidates
  const RefactorCandidatesBodySchema = z.object({
    threshold: z.number().min(0).max(1).optional().default(0.88),
    topK: z.number().int().positive().max(50).optional().default(50),
    level: z.enum(['symbol', 'chunk', 'file']).optional().default('symbol'),
  })
  router.post('/refactor-candidates', (req, res) => {
    const parsed = RefactorCandidatesBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    try {
      const report = computeRefactorCandidates(parsed.data)
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /insights/lifecycle
  const LifecycleBodySchema = z.object({
    ...modelOverrideSchema.shape,
    query: z.string().min(1),
    steps: z.number().int().min(2).max(50).optional().default(10),
    threshold: z.number().min(0).max(1).optional().default(0.7),
  })
  router.post('/lifecycle', async (req, res) => {
    const parsed = LifecycleBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let qEmb: Embedding
    try {
      const provider = resolveRequestProvider(opts, textProvider)
      qEmb = await provider.embed(opts.query)
    } catch (err) {
      const status = err instanceof ModelOverrideError ? 400 : 502
      res.status(status).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const result = computeConceptLifecycle(qEmb, opts.query, { steps: opts.steps, threshold: opts.threshold })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /insights/cherry-pick-suggest
  const CherryPickBodySchema = z.object({
    ...modelOverrideSchema.shape,
    query: z.string().min(1),
    topK: z.number().int().positive().max(25).optional().default(10),
  })
  router.post('/cherry-pick-suggest', async (req, res) => {
    const parsed = CherryPickBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let qEmb: Embedding
    let provider: EmbeddingProvider
    try {
      provider = resolveRequestProvider(opts, textProvider)
      qEmb = await provider.embed(opts.query)
    } catch (err) {
      const status = err instanceof ModelOverrideError ? 400 : 502
      res.status(status).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const results = await suggestCherryPicks(qEmb, { topK: opts.topK, model: provider.model })
      res.json({ query: opts.query, results })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /insights/file-diff
  const FileDiffBodySchema = z.object({
    ref1: z.string().min(1),
    ref2: z.string().min(1),
    path: z.string().min(1),
    neighbors: z.number().int().min(0).max(10).optional().default(0),
  })
  router.post('/file-diff', async (req, res) => {
    const parsed = FileDiffBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const result = await computeDiff(opts.ref1, opts.ref2, opts.path, { neighbors: opts.neighbors })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /insights/pr-report
  const PrReportBodySchema = z.object({
    ...modelOverrideSchema.shape,
    ref1: z.string().optional().default('HEAD~1'),
    ref2: z.string().optional().default('HEAD'),
    file: z.string().optional(),
    query: z.string().optional(),
    top: z.number().int().positive().max(25).optional().default(10),
  })
  router.post('/pr-report', async (req, res) => {
    const parsed = PrReportBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    const report: Record<string, unknown> = { ref1: opts.ref1, ref2: opts.ref2 }

    let provider: EmbeddingProvider | undefined
    if (opts.file || opts.query) {
      try {
        provider = resolveRequestProvider(opts, textProvider)
      } catch (err) {
        const status = err instanceof ModelOverrideError ? 400 : 502
        res.status(status).json({ error: `Provider resolution failed: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
    }

    if (opts.file && provider) {
      try {
        const emb = await provider.embed(opts.file)
        const diff = computeSemanticDiff(emb, opts.file, opts.ref1, opts.ref2, opts.top)
        report.semanticDiff = { gained: diff.gained.length, lost: diff.lost.length, stable: diff.stable.length }
      } catch (err) {
        report.semanticDiff = { error: err instanceof Error ? err.message : String(err) }
      }
      try {
        const impactReport = await computeImpact(opts.file, provider, { topK: opts.top })
        report.impactedModules = impactReport.results.map((r) => ({ path: r.paths[0] ?? null, score: r.score }))
      } catch (err) {
        report.impactedModules = { error: err instanceof Error ? err.message : String(err) }
      }
    }

    if (opts.query && provider) {
      try {
        const emb = await provider.embed(opts.query)
        const cpReport = computeConceptChangePoints(opts.query, emb, { topK: opts.top, topPoints: 5 })
        report.changePoints = cpReport.points.map((p) => ({
          distance: p.distance,
          before: { commit: p.before.commit, date: p.before.date },
          after: { commit: p.after.commit, date: p.after.date },
        }))
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

    res.json(report)
  })

  // POST /insights/regression-gate
  // Mirrors the CLI's exit-code contract (0 pass / 3 gate-failed) via HTTP
  // status: 200 when all concepts pass, 422 when any concept's drift exceeds
  // its threshold — same convention as POST /analysis/policy-check.
  const RegressionGateBodySchema = z.object({
    ...modelOverrideSchema.shape,
    base: z.string().optional().default('main'),
    head: z.string().optional().default('HEAD'),
    queries: z.array(z.object({
      query: z.string().min(1),
      threshold: z.number().min(0).max(2).optional(),
    })).min(1),
    threshold: z.number().min(0).max(2).optional().default(0.15),
    topK: z.number().int().positive().max(50).optional().default(10),
  })
  router.post('/regression-gate', async (req, res) => {
    const parsed = RegressionGateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let provider: EmbeddingProvider
    try {
      provider = resolveRequestProvider(opts, textProvider)
    } catch (err) {
      const status = err instanceof ModelOverrideError ? 400 : 502
      res.status(status).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const embeddedQueries: RegressionGateQuery[] = []
      for (const q of opts.queries) {
        const emb = await provider.embed(q.query)
        embeddedQueries.push({ query: q.query, embedding: emb, threshold: q.threshold ?? opts.threshold })
      }
      const report = await computeRegressionGate(embeddedQueries, { baseRef: opts.base, headRef: opts.head, topK: opts.topK })
      res.status(report.allPassed ? 200 : 422).json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /insights/code-review
  const CodeReviewBodySchema = z.object({
    ...modelOverrideSchema.shape,
    diffText: z.string().min(1),
    topK: z.number().int().positive().max(25).optional().default(5),
    threshold: z.number().min(0).max(1).optional().default(0.75),
    lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('semantic'),
  })
  router.post('/code-review', async (req, res) => {
    const parsed = CodeReviewBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    const hunks = parseDiff(opts.diffText)
    if (hunks.length === 0) {
      res.json({ reviews: [] })
      return
    }
    let provider: EmbeddingProvider
    try {
      provider = resolveRequestProvider(opts, textProvider)
    } catch (err) {
      const status = err instanceof ModelOverrideError ? 400 : 502
      res.status(status).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const lens = parseLens(opts.lens, 'semantic')
      const graph = lens !== 'semantic' ? getCachedStorageProfile(process.cwd()).graph : undefined
      const reviews = await computeCodeReview(hunks, provider, { topK: opts.topK, threshold: opts.threshold, graph })
      res.json({ reviews })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /insights/heatmap
  const HeatmapBodySchema = z.object({
    period: z.enum(['week', 'month']).optional().default('week'),
  })
  router.post('/heatmap', (req, res) => {
    const parsed = HeatmapBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const { period } = parsed.data
    try {
      const { rawDb } = getActiveSession()
      const fmt = period === 'month' ? `'%Y-%m'` : `'%Y-%W'`
      const rows = rawDb.prepare(
        `SELECT strftime(${fmt}, datetime(c.timestamp, 'unixepoch')) AS period, COUNT(DISTINCT b.blob_hash) AS cnt
         FROM blob_commits b JOIN commits c ON b.commit_hash = c.commit_hash
         GROUP BY period ORDER BY period`,
      ).all() as Array<{ period: string; cnt: number }>
      const buckets: Record<string, number> = {}
      for (const r of rows) buckets[r.period] = r.cnt
      res.json({ period, buckets })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /insights/map
  // Serves the most recent k-means cluster snapshot + per-cluster blob-
  // assignment counts — the data source behind the CLI `map` command and
  // `gitsema tools serve --ui`'s cluster overlay (companion to the existing
  // `GET /projections` route, Phase 55).
  router.post('/map', (_req, res) => {
    try {
      const { rawDb } = getActiveSession()
      const clusters = rawDb.prepare('SELECT id, label, size, representative_paths FROM blob_clusters').all() as Array<{ id: number; label: string; size: number; representative_paths: string | null }>
      const assignmentRows = rawDb.prepare('SELECT cluster_id, COUNT(*) AS cnt FROM cluster_assignments GROUP BY cluster_id').all() as Array<{ cluster_id: number; cnt: number }>
      const assignmentCounts: Record<number, number> = {}
      for (const r of assignmentRows) assignmentCounts[r.cluster_id] = r.cnt
      const clusterList = clusters.map((c) => ({
        id: c.id,
        label: c.label,
        size: c.size,
        representativePaths: c.representative_paths ? (JSON.parse(c.representative_paths) as string[]) : [],
        assignedBlobCount: assignmentCounts[c.id] ?? 0,
      }))
      res.json({ clusters: clusterList })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
