/**
 * HTTP routes for analysis commands (Phase 34).
 *
 * Routes (under /api/v1/analysis/):
 *   POST /clusters      — k-means cluster all indexed blobs
 *   POST /change-points — find concept change points in history
 *   POST /author        — attribute a semantic concept to authors
 *   POST /impact        — find semantically coupled blobs for a file
 */

import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import { computeClusters, getBlobHashesOnBranch } from '../../core/search/clustering.js'
import { computeConceptChangePoints } from '../../core/search/changePoints.js'
import { computeAuthorContributions } from '../../core/search/authorSearch.js'
import { computeExperts } from '../../core/search/experts.js'
import { computeImpact } from '../../core/search/impact.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { computeSemanticDiff } from '../../core/search/semanticDiff.js'
import { computeSemanticBlame } from '../../core/search/semanticBlame.js'
import { findDeadConcepts } from '../../core/search/deadConcepts.js'
import { computeSemanticCollisions, computeMergeImpact } from '../../core/search/mergeAudit.js'
import { computeBranchSummary } from '../../core/search/branchSummary.js'
import { getMergeBase, getBranchExclusiveBlobs } from '../../core/git/branchDiff.js'
import { scanForVulnerabilities } from '../../core/search/securityScan.js'
import { computeHealthTimeline } from '../../core/search/healthTimeline.js'
import { scoreDebt } from '../../core/search/debtScoring.js'
import { computeDocGap } from '../../core/search/docGap.js'
import { computeContributorProfile } from '../../core/search/contributorProfile.js'
import { computeOwnershipHeatmap } from '../../core/search/ownershipHeatmap.js'
import { computeSemanticBisect } from '../../core/search/semanticBisect.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { computeEvolution } from '../../core/search/evolution.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import { multiRepoSearch } from '../../core/indexing/repoRegistry.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'

const ClustersBodySchema = z.object({
  k: z.number().int().positive().optional().default(8),
  topKeywords: z.number().int().positive().optional().default(5),
  useEnhancedLabels: z.boolean().optional().default(false),
  branch: z.string().optional(),
})

const ChangePointsBodySchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().optional().default(50),
  threshold: z.number().min(0).max(2).optional().default(0.3),
  topPoints: z.number().int().positive().optional().default(5),
  branch: z.string().optional(),
})

const AuthorBodySchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().optional().default(50),
  topAuthors: z.number().int().positive().optional().default(10),
  branch: z.string().optional(),
})

const ImpactBodySchema = z.object({
  file: z.string().min(1),
  topK: z.number().int().positive().optional().default(10),
  branch: z.string().optional(),
})

const ExpertsBodySchema = z.object({
  topN: z.number().int().positive().optional().default(10),
  since: z.string().optional(),
  until: z.string().optional(),
  minBlobs: z.number().int().positive().optional().default(1),
  topClusters: z.number().int().positive().optional().default(5),
})

export interface AnalysisRouterDeps {
  textProvider: EmbeddingProvider
}

export function analysisRouter(deps: AnalysisRouterDeps): Router {
  const { textProvider } = deps
  const router = Router()

  // POST /analysis/clusters
  router.post('/clusters', async (req, res) => {
    const parsed = ClustersBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const blobHashFilter = opts.branch ? getBlobHashesOnBranch(opts.branch) : undefined
      const report = await computeClusters({
        k: opts.k,
        topKeywords: opts.topKeywords,
        useEnhancedLabels: opts.useEnhancedLabels,
        blobHashFilter,
      })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/change-points
  router.post('/change-points', async (req, res) => {
    const parsed = ChangePointsBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let queryEmbedding: Embedding
    try {
      queryEmbedding = await textProvider.embed(opts.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const report = computeConceptChangePoints(opts.query, queryEmbedding, {
        topK: opts.topK,
        threshold: opts.threshold,
        topPoints: opts.topPoints,
        branch: opts.branch,
      })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/author
  router.post('/author', async (req, res) => {
    const parsed = AuthorBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let queryEmbedding: Embedding
    try {
      queryEmbedding = await textProvider.embed(opts.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const contributions = await computeAuthorContributions(queryEmbedding, {
        topK: opts.topK,
        topAuthors: opts.topAuthors,
        branch: opts.branch,
      })
      res.json(contributions)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/experts
  router.post('/experts', async (req, res) => {
    const parsed = ExpertsBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let since: number | undefined
    let until: number | undefined
    try {
      if (opts.since) since = parseDateArg(opts.since)
      if (opts.until) until = parseDateArg(opts.until)
    } catch {
      res.status(400).json({ error: 'Invalid date' })
      return
    }
    try {
      const experts = computeExperts({ topN: opts.topN, since, until, minBlobs: opts.minBlobs, topClusters: opts.topClusters })
      res.json({ experts })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/impact
  router.post('/impact', async (req, res) => {
    const parsed = ImpactBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const report = await computeImpact(opts.file, textProvider, {
        topK: opts.topK,
        branch: opts.branch,
      })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/semantic-diff
  const SemanticDiffBodySchema = z.object({
    ref1: z.string().min(1),
    ref2: z.string().min(1),
    query: z.string().min(1),
    topK: z.number().int().positive().optional().default(10),
    branch: z.string().optional(),
  })
  router.post('/semantic-diff', async (req, res) => {
    const parsed = SemanticDiffBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let qEmb: Embedding
    try {
      qEmb = await textProvider.embed(opts.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const result = computeSemanticDiff(qEmb, opts.query, opts.ref1, opts.ref2, opts.topK, opts.branch)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/semantic-blame
  const SemanticBlameBodySchema = z.object({
    filePath: z.string().min(1),
    content: z.string().min(1),
    topK: z.number().int().positive().optional().default(3),
    searchSymbols: z.boolean().optional().default(false),
    branch: z.string().optional(),
  })
  router.post('/semantic-blame', async (req, res) => {
    const parsed = SemanticBlameBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let qEmbProvider = textProvider
    try {
      const entries = await computeSemanticBlame(opts.filePath, opts.content, qEmbProvider, { topK: opts.topK, searchSymbols: opts.searchSymbols, branch: opts.branch })
      res.json(entries)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/dead-concepts
  const DeadConceptsBodySchema = z.object({
    topK: z.number().int().positive().optional().default(10),
    since: z.string().optional(),
    branch: z.string().optional(),
  })
  router.post('/dead-concepts', async (req, res) => {
    const parsed = DeadConceptsBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let sinceTs: number | undefined
    if (opts.since) {
      try {
        sinceTs = parseDateArg(opts.since)
      } catch (err) {
        res.status(400).json({ error: `Invalid since date: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
    }
    try {
      const results = await findDeadConcepts({ topK: opts.topK, since: sinceTs, branch: opts.branch })
      res.json(results)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/merge-audit
  const MergeAuditBodySchema = z.object({
    branchA: z.string().min(1),
    branchB: z.string().min(1),
    threshold: z.number().min(0).max(1).optional().default(0.85),
    topK: z.number().int().positive().optional().default(10),
  })
  router.post('/merge-audit', async (req, res) => {
    const parsed = MergeAuditBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const mergeBase = getMergeBase(opts.branchA, opts.branchB)
      const blobsA = getBranchExclusiveBlobs(opts.branchA, mergeBase)
      const blobsB = getBranchExclusiveBlobs(opts.branchB, mergeBase)
      const report = computeSemanticCollisions(blobsA, blobsB, opts.branchA, opts.branchB, mergeBase, { threshold: opts.threshold, topK: opts.topK })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/merge-preview
  const MergePreviewBodySchema = z.object({
    branch: z.string().min(1),
    into: z.string().optional().default('main'),
    k: z.number().int().positive().optional().default(8),
  })
  router.post('/merge-preview', async (req, res) => {
    const parsed = MergePreviewBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const report = await computeMergeImpact(opts.branch, opts.into, { k: opts.k })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/branch-summary
  const BranchSummaryBodySchema = z.object({
    branch: z.string().min(1),
    baseBranch: z.string().optional().default('main'),
    topConcepts: z.number().int().positive().optional().default(5),
  })
  router.post('/branch-summary', async (req, res) => {
    const parsed = BranchSummaryBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const report = await computeBranchSummary(opts.branch, opts.baseBranch, { topConcepts: opts.topConcepts })
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/security-scan
  // Returns semantic similarity findings for common vulnerability patterns.
  // Results are similarity scores, NOT confirmed vulnerabilities.
  const SecurityScanBodySchema = z.object({
    top: z.number().int().positive().optional().default(10),
    model: z.string().optional(),
  })
  router.post('/security-scan', async (req, res) => {
    const parsed = SecurityScanBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const session = getActiveSession()
      const findings = await scanForVulnerabilities(session, textProvider, { top: opts.top, model: opts.model })
      res.json({ disclaimer: 'Results are semantic similarity scores, not confirmed vulnerabilities. Manual review required.', findings })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/health
  // Returns time-bucketed codebase health snapshots.
  const HealthBodySchema = z.object({
    buckets: z.number().int().positive().optional().default(12),
    branch: z.string().optional(),
  })
  router.post('/health', (req, res) => {
    const parsed = HealthBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const session = getActiveSession()
      const snapshots = computeHealthTimeline(session, { buckets: opts.buckets, branch: opts.branch })
      res.json(snapshots)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/debt
  // Scores blobs by technical debt (age + isolation + change-frequency signals).
  const DebtBodySchema = z.object({
    top: z.number().int().positive().optional().default(20),
    model: z.string().optional(),
    branch: z.string().optional(),
  })
  router.post('/debt', async (req, res) => {
    const parsed = DebtBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const session = getActiveSession()
      const results = await scoreDebt(session, textProvider, { top: opts.top, model: opts.model, branch: opts.branch })
      res.json(results)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  const MultiRepoSearchBodySchema = z.object({
    query: z.string().min(1),
    repoIds: z.array(z.string()).optional(),
    topK: z.number().int().positive().optional().default(10),
    model: z.string().optional(),
  })
  router.post('/multi-repo-search', async (req, res) => {
    const parsed = MultiRepoSearchBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const { query, repoIds, topK, model } = parsed.data
    try {
      const session = getActiveSession()
      const embedding = await embedQuery(textProvider, query) as number[]
      const results = await multiRepoSearch(session, embedding, { repoIds, topK, model })
      res.json(results)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/doc-gap
  // Find code blobs least covered by documentation (lowest cosine similarity to any doc blob).
  const DocGapBodySchema = z.object({
    top: z.number().int().positive().optional().default(20),
    threshold: z.number().min(0).max(1).optional(),
    branch: z.string().optional(),
  })
  router.post('/doc-gap', async (req, res) => {
    const parsed = DocGapBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const results = await computeDocGap({ topK: opts.top, threshold: opts.threshold, branch: opts.branch })
      res.json(results)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/contributor-profile
  // Return top blobs most similar to the centroid of a contributor's authored blobs.
  const ContributorProfileBodySchema = z.object({
    author: z.string().min(1),
    top: z.number().int().positive().optional().default(10),
    branch: z.string().optional(),
  })
  router.post('/contributor-profile', async (req, res) => {
    const parsed = ContributorProfileBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    try {
      const results = await computeContributorProfile(opts.author, { topK: opts.top, branch: opts.branch })
      res.json(results)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/triage
  // Composite incident-triage bundle: first-seen, change-points, file-evolution, bisect, experts.
  const TriageBodySchema = z.object({
    query: z.string().min(1),
    top: z.number().int().positive().optional().default(5),
    ref1: z.string().optional(),
    ref2: z.string().optional(),
    file: z.string().optional(),
  })
  router.post('/triage', async (req, res) => {
    const parsed = TriageBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let queryEmbedding: number[]
    try {
      queryEmbedding = await embedQuery(textProvider, opts.query) as number[]
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    const sections: Record<string, unknown> = {}
    try {
      sections.firstSeen = vectorSearch(queryEmbedding, { topK: opts.top })
    } catch (err) {
      sections.firstSeen = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.changePoints = computeConceptChangePoints(opts.query, queryEmbedding, { topK: opts.top })
    } catch (err) {
      sections.changePoints = { error: err instanceof Error ? err.message : String(err) }
    }
    if (opts.file) {
      try {
        sections.fileEvolution = computeEvolution(opts.file)
      } catch (err) {
        sections.fileEvolution = { error: err instanceof Error ? err.message : String(err) }
      }
    }
    try {
      const ref1 = opts.ref1 ?? 'HEAD~10'
      const ref2 = opts.ref2 ?? 'HEAD'
      sections.bisect = computeSemanticBisect(queryEmbedding, opts.query, ref1, ref2, { topK: opts.top })
    } catch (err) {
      sections.bisect = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.experts = computeExperts({ topN: opts.top })
    } catch (err) {
      sections.experts = { error: err instanceof Error ? err.message : String(err) }
    }
    res.json({ query: opts.query, sections })
  })

  // POST /analysis/policy-check
  // Automated CI gate: check debt, security similarity, and concept drift against thresholds.
  const PolicyCheckBodySchema = z.object({
    maxDebtScore: z.number().positive().optional(),
    minSecurityScore: z.number().positive().optional(),
    maxDrift: z.number().min(0).max(2).optional(),
    query: z.string().optional(),
  })
  router.post('/policy-check', async (req, res) => {
    const parsed = PolicyCheckBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    if (opts.maxDrift !== undefined && !opts.query) {
      res.status(400).json({ error: '`query` is required when `maxDrift` is set' })
      return
    }
    const session = getActiveSession()
    const results: { passed: boolean; checks: Record<string, { passed: boolean; [k: string]: unknown }> } = {
      passed: true,
      checks: {},
    }
    // Debt gate
    if (opts.maxDebtScore !== undefined) {
      try {
        const debtItems = await scoreDebt(session, textProvider)
        const avgScore = debtItems.length > 0
          ? debtItems.reduce((s, r) => s + r.debtScore, 0) / debtItems.length
          : 0
        const passed = avgScore <= opts.maxDebtScore
        results.checks.debt = { avgScore, passed }
        if (!passed) results.passed = false
      } catch (err) {
        results.checks.debt = { passed: false, error: err instanceof Error ? err.message : String(err) }
        results.passed = false
      }
    }
    // Security gate
    if (opts.minSecurityScore !== undefined) {
      try {
        const findings = await scanForVulnerabilities(session, textProvider)
        const maxSim = findings.length > 0 ? Math.max(...findings.map((f) => f.score)) : 0
        const passed = maxSim <= opts.minSecurityScore
        results.checks.security = { maxSimilarity: maxSim, passed }
        if (!passed) results.passed = false
      } catch (err) {
        results.checks.security = { passed: false, error: err instanceof Error ? err.message : String(err) }
        results.passed = false
      }
    }
    // Drift gate
    if (opts.maxDrift !== undefined && opts.query) {
      try {
        const emb = await embedQuery(textProvider, opts.query) as number[]
        const cps = computeConceptChangePoints(opts.query, emb, { topK: 50 })
        const maxDist = cps.points.length > 0 ? Math.max(...cps.points.map((c) => c.distance)) : 0
        const passed = maxDist <= opts.maxDrift
        results.checks.drift = { maxDistance: maxDist, passed }
        if (!passed) results.passed = false
      } catch (err) {
        results.checks.drift = { passed: false, error: err instanceof Error ? err.message : String(err) }
        results.passed = false
      }
    }
    res.status(results.passed ? 200 : 422).json(results)
  })

  // POST /analysis/ownership
  // Ownership heatmap: who owns the concept area described by a query.
  const OwnershipBodySchema = z.object({
    query: z.string().min(1),
    top: z.number().int().positive().optional().default(5),
    windowDays: z.number().int().positive().optional().default(90),
  })
  router.post('/ownership', async (req, res) => {
    const parsed = OwnershipBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    let queryEmbedding: number[]
    try {
      queryEmbedding = await embedQuery(textProvider, opts.query) as number[]
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    try {
      const heatmap = computeOwnershipHeatmap({ embedding: queryEmbedding, topK: opts.top, windowDays: opts.windowDays })
      res.json(heatmap)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /analysis/workflow
  // Run a named workflow template (pr-review | incident | release-audit).
  const WorkflowBodySchema = z.object({
    template: z.enum(['pr-review', 'incident', 'release-audit']),
    query: z.string().optional(),
    file: z.string().optional(),
    top: z.number().int().positive().optional().default(5),
    base: z.string().optional(),
  })
  router.post('/workflow', async (req, res) => {
    const parsed = WorkflowBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const opts = parsed.data
    if (opts.template === 'pr-review' && !opts.file) {
      res.status(400).json({ error: '`file` is required for the pr-review template' })
      return
    }
    if (opts.template === 'incident' && !opts.query) {
      res.status(400).json({ error: '`query` is required for the incident template' })
      return
    }
    const top = opts.top
    const sections: Record<string, unknown> = {}

    if (opts.template === 'pr-review') {
      const query = opts.query ?? opts.file ?? ''
      let emb: number[]
      try {
        emb = await embedQuery(textProvider, query) as number[]
      } catch (err) {
        res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
      try { sections.impact = await computeImpact(opts.file!, textProvider, { topK: top }) }
      catch (err) { sections.impact = { error: err instanceof Error ? err.message : String(err) } }
      try { sections.changePoints = computeConceptChangePoints(query, emb, { topK: top }) }
      catch (err) { sections.changePoints = { error: err instanceof Error ? err.message : String(err) } }
      try { sections.experts = computeExperts({ topN: top }) }
      catch (err) { sections.experts = { error: err instanceof Error ? err.message : String(err) } }

    } else if (opts.template === 'incident') {
      let emb: number[]
      try {
        emb = await embedQuery(textProvider, opts.query!) as number[]
      } catch (err) {
        res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
      try { sections.firstSeen = vectorSearch(emb, { topK: top }) }
      catch (err) { sections.firstSeen = { error: err instanceof Error ? err.message : String(err) } }
      try { sections.changePoints = computeConceptChangePoints(opts.query!, emb, { topK: top }) }
      catch (err) { sections.changePoints = { error: err instanceof Error ? err.message : String(err) } }
      try { sections.experts = computeExperts({ topN: top }) }
      catch (err) { sections.experts = { error: err instanceof Error ? err.message : String(err) } }

    } else {
      // release-audit
      const query = opts.query ?? 'architecture changes quality'
      let emb: number[]
      try {
        emb = await embedQuery(textProvider, query) as number[]
      } catch (err) {
        res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
      try { sections.topChangedConcepts = vectorSearch(emb, { topK: top }) }
      catch (err) { sections.topChangedConcepts = { error: err instanceof Error ? err.message : String(err) } }
      try { sections.changePoints = computeConceptChangePoints(query, emb, { topK: top }) }
      catch (err) { sections.changePoints = { error: err instanceof Error ? err.message : String(err) } }
      try { sections.experts = computeExperts({ topN: top }) }
      catch (err) { sections.experts = { error: err instanceof Error ? err.message : String(err) } }
    }

    res.json({ template: opts.template, sections })
  })

  // POST /analysis/eval
  // Retrieval evaluation harness: accepts inline eval cases and returns P@k, R@k, MRR metrics.
  const EvalCaseSchema = z.object({
    query: z.string().min(1),
    expectedPaths: z.array(z.string()),
  })
  const EvalBodySchema = z.object({
    cases: z.array(EvalCaseSchema).min(1),
    top: z.number().int().positive().optional().default(10),
  })
  router.post('/eval', async (req, res) => {
    const parsed = EvalBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const { cases, top: topK } = parsed.data

    function precisionAtK(topPaths: string[], expected: string[]): number {
      if (topPaths.length === 0) return 0
      const s = new Set(expected)
      return topPaths.filter((p) => s.has(p)).length / topPaths.length
    }
    function recallAtK(topPaths: string[], expected: string[]): number {
      if (expected.length === 0) return 1
      const s = new Set(expected)
      return topPaths.filter((p) => s.has(p)).length / expected.length
    }
    function mrrScore(topPaths: string[], expected: string[]): number {
      const s = new Set(expected)
      for (let i = 0; i < topPaths.length; i++) {
        if (s.has(topPaths[i])) return 1 / (i + 1)
      }
      return 0
    }

    const results: Array<{
      query: string
      expectedPaths: string[]
      topPaths: string[]
      precisionAtK: number
      recallAtK: number
      mrr: number
      latencyMs: number
    }> = []

    for (const c of cases) {
      const t0 = Date.now()
      let topPaths: string[] = []
      try {
        const emb = await embedQuery(textProvider, c.query) as number[]
        const hits = vectorSearch(emb, { topK })
        topPaths = hits.flatMap((h) => (h.paths ?? []).slice(0, 1))
      } catch {
        // leave topPaths empty
      }
      const latencyMs = Date.now() - t0
      results.push({
        query: c.query,
        expectedPaths: c.expectedPaths,
        topPaths,
        precisionAtK: precisionAtK(topPaths, c.expectedPaths),
        recallAtK: recallAtK(topPaths, c.expectedPaths),
        mrr: mrrScore(topPaths, c.expectedPaths),
        latencyMs,
      })
    }

    const n = results.length
    const summary = {
      avgPrecision: results.reduce((s, r) => s + r.precisionAtK, 0) / n,
      avgRecall: results.reduce((s, r) => s + r.recallAtK, 0) / n,
      avgMRR: results.reduce((s, r) => s + r.mrr, 0) / n,
      avgLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0) / n,
      topK,
    }

    res.json({ cases: results, summary })
  })

  return router
}
