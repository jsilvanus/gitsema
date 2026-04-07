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

  return router
}
