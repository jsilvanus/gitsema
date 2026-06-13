/**
 * guideTools — gitsema tool registry for the `gitsema guide` agentic loop.
 *
 * Exposes the full set of gitsema analysis capabilities as `ToolDefinition`s
 * (JSON-schema parameter shapes) plus a single `executeTool` dispatcher that
 * `runAgentLoop` (from `@jsilvanus/chattydeer`) calls back into for each tool
 * invocation.
 *
 * All tool results are returned as compact, size-capped JSON strings — the
 * agent loop feeds these back to the LLM as `tool` messages. Tools never
 * throw: failures are converted into a structured `{ error: ... }` JSON
 * payload so the LLM can react gracefully.
 *
 * Each tool name matches an entry (or alias) in
 * `src/core/narrator/interpretations.ts` — that registry is the single
 * source of truth for how the LLM should interpret each tool's output, and
 * is embedded in the guide's system prompt via `buildGuideToolCatalog()`.
 * If a tool's result shape changes here, update its entry there too.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fetchCommitEvents, runNarrate, runExplain } from './narrator.js'
import { createDisabledProvider } from './chattydeerProvider.js'
import { getActiveSession, DB_PATH } from '../db/sqlite.js'
import { getTextProvider, getCodeProvider, buildProvider } from '../embedding/providerFactory.js'
import { embedQuery } from '../embedding/embedQuery.js'
import { vectorSearch } from '../search/analysis/vectorSearch.js'
import { hybridSearch } from '../search/analysis/hybridSearch.js'
import { searchCommits } from '../search/commitSearch.js'
import { multiRepoSearch } from '../indexing/repoRegistry.js'
import { computeEvolution, computeConceptEvolution } from '../search/temporal/evolution.js'
import { computeConceptChangePoints, computeFileChangePoints } from '../search/temporal/changePoints.js'
import { computeHealthTimeline } from '../search/temporal/healthTimeline.js'
import { computeBranchSummary } from '../search/branchSummary.js'
import { computeSemanticCollisions, computeMergeImpact } from '../search/mergeAudit.js'
import { computeAuthorContributions } from '../search/authorSearch.js'
import { computeExperts } from '../search/experts.js'
import { computeOwnershipHeatmap } from '../search/ownershipHeatmap.js'
import { computeContributorProfile } from '../search/contributorProfile.js'
import { computeImpact } from '../search/impact.js'
import { findDeadConcepts } from '../search/deadConcepts.js'
import { scoreDebt } from '../search/debtScoring.js'
import { computeDocGap } from '../search/docGap.js'
import { scanForVulnerabilities } from '../search/securityScan.js'
import { computeSemanticDiff } from '../search/semanticDiff.js'
import { computeSemanticBlame } from '../search/semanticBlame.js'
import {
  computeClusters,
  computeClusterSnapshot,
  compareClusterSnapshots,
  computeClusterTimeline,
  resolveRefToTimestamp,
  getBlobHashesUpTo,
  getBlobHashesOnBranch,
} from '../search/clustering/clustering.js'
import { parseDateArg } from '../search/temporal/timeSearch.js'
import { runIndex } from '../indexing/indexer.js'
import { DEFAULT_MAX_SIZE } from '../git/showBlob.js'
import type { ToolCategory } from './interpretations.js'
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Result size capping
// ---------------------------------------------------------------------------

const MAX_RESULT_CHARS = 4000

/** Serialize `value` to JSON and cap the result to ~4000 chars. */
function toCappedJson(value: unknown): string {
  let json: string
  try {
    json = JSON.stringify(value)
  } catch (err) {
    return JSON.stringify({ error: `serialization failed: ${err instanceof Error ? err.message : String(err)}` })
  }
  if (json.length <= MAX_RESULT_CHARS) return json
  return `${json.slice(0, MAX_RESULT_CHARS)}…truncated`
}

function errorResult(message: string): { error: string } {
  return { error: message }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Whether a `.gitsema` index exists in the current directory. */
function hasIndex(): boolean {
  return existsSync(join(process.cwd(), DB_PATH))
}

/**
 * Ensure an index is present and openable. Returns an error object when not,
 * or `null` when the index is ready to use.
 */
function requireIndex(): { error: string } | null {
  if (!hasIndex()) {
    return errorResult('no .gitsema index found in the current directory — run `gitsema index` first')
  }
  try {
    getActiveSession()
  } catch (err) {
    return errorResult(`index unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }
  return null
}

/** Embed `query` with the text (default) or code embedding provider. */
async function embedFor(query: string, useCode = false) {
  const provider = useCode ? getCodeProvider() : getTextProvider()
  const embedding = await embedQuery(provider, query)
  return { provider, embedding }
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v : undefined
}

function numArg(args: Record<string, unknown>, key: string, def: number, min: number, max: number): number {
  const v = args[key]
  const n = typeof v === 'number' ? v : parseInt(String(v ?? def), 10)
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : def
}

function boolArg(args: Record<string, unknown>, key: string, def = false): boolean {
  const v = args[key]
  return typeof v === 'boolean' ? v : def
}

function dateArg(value: string | undefined): number | undefined {
  if (!value) return undefined
  try {
    return parseDateArg(value)
  } catch {
    return undefined
  }
}

/** Read a file's content at HEAD via `git show` (used by semantic_blame). */
function readHeadFile(path: string): string {
  try {
    return execSync(`git show HEAD:"${path}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Tool definitions (JSON-schema parameters for the LLM)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface GuideToolEntry {
  definition: ToolDefinition
  category: ToolCategory
  /** Whether this tool requires a `.gitsema` index to be present. */
  needsIndex: boolean
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
})

const str = (description: string) => ({ type: 'string', description })
const int = (description: string, opts: { min?: number; max?: number } = {}) => ({
  type: 'integer',
  description,
  ...(opts.min !== undefined ? { minimum: opts.min } : {}),
  ...(opts.max !== undefined ? { maximum: opts.max } : {}),
})
const bool = (description: string) => ({ type: 'boolean', description })

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const GUIDE_TOOLS: Record<string, GuideToolEntry> = {
  // -------------------------------------------------------------------------
  // Repository (git-only, no index required)
  // -------------------------------------------------------------------------
  repo_stats: {
    category: 'repo',
    needsIndex: false,
    definition: {
      name: 'repo_stats',
      description: 'Basic repository statistics: branch count, tag count, total commit count, and configured remotes.',
      parameters: obj({}),
    },
    run: () => repoStatsData(),
  },
  recent_commits: {
    category: 'repo',
    needsIndex: false,
    definition: {
      name: 'recent_commits',
      description: 'Fetch the N most recent git commits (hash, date, subject).',
      parameters: obj({ n: int('Number of commits to return (default 20, max 100).', { min: 1, max: 100 }) }),
    },
    run: (args) => recentCommitsData(numArg(args, 'n', 20, 1, 100)),
  },
  narrate_repo: {
    category: 'repo',
    needsIndex: false,
    definition: {
      name: 'narrate_repo',
      description: 'Return structured commit evidence for a date range and optional focus (evidence only — does not call an LLM).',
      parameters: obj({
        since: str('Start date (e.g. "2024-01-01") or git-recognized date expression.'),
        until: str('End date (e.g. "2024-12-31") or git-recognized date expression.'),
        focus: { type: 'string', description: 'Restrict to a category of commits.', enum: ['bugs', 'features', 'ops', 'security', 'deps', 'performance', 'all'] },
      }),
    },
    run: async (args) => {
      const focusRaw = strArg(args, 'focus') ?? 'all'
      const focus = (['bugs', 'features', 'ops', 'security', 'deps', 'performance', 'all'].includes(focusRaw) ? focusRaw : 'all') as
        'bugs' | 'features' | 'ops' | 'security' | 'deps' | 'performance' | 'all'
      const result = await runNarrate(createDisabledProvider(), {
        since: strArg(args, 'since'),
        until: strArg(args, 'until'),
        focus,
        evidenceOnly: true,
      })
      return { commitCount: result.commitCount, citations: result.citations, evidence: result.evidence }
    },
  },
  explain_topic: {
    category: 'repo',
    needsIndex: false,
    definition: {
      name: 'explain_topic',
      description: 'Return commits whose subject/body match a topic, for incident/feature investigation (evidence only — does not call an LLM).',
      parameters: obj({
        topic: str('Keyword(s) or phrase to search commit messages for.'),
        since: str('Start date or git-recognized date expression.'),
        until: str('End date or git-recognized date expression.'),
      }, ['topic']),
    },
    run: async (args) => {
      const topic = strArg(args, 'topic')
      if (!topic) return errorResult('explain_topic requires a non-empty "topic" argument')
      const result = await runExplain(createDisabledProvider(), topic, {
        since: strArg(args, 'since'),
        until: strArg(args, 'until'),
        evidenceOnly: true,
      })
      return { commitCount: result.commitCount, citations: result.citations, evidence: result.evidence }
    },
  },

  // -------------------------------------------------------------------------
  // Search & discovery
  // -------------------------------------------------------------------------
  semantic_search: {
    category: 'search',
    needsIndex: true,
    definition: {
      name: 'semantic_search',
      description: 'Vector similarity search over the indexed git history. Returns the top matching files/blobs.',
      parameters: obj({
        query: str('Natural-language search query.'),
        top_k: int('Number of results to return (default 10, max 25).', { min: 1, max: 25 }),
        branch: str('Restrict results to blobs seen on this branch.'),
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('semantic_search requires a non-empty "query" argument')
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const { provider, embedding } = await embedFor(query)
      const results = vectorSearch(embedding, { topK, model: provider.model, queryText: query, branch: strArg(args, 'branch') })
      return { query, results: results.map((r) => ({ paths: r.paths, score: r.score, blobHash: r.blobHash })) }
    },
  },
  code_search: {
    category: 'search',
    needsIndex: true,
    definition: {
      name: 'code_search',
      description: 'Search code using the code embedding model and return symbol/chunk-level matches.',
      parameters: obj({
        snippet: str('Code snippet to embed and search for.'),
        top_k: int('Maximum number of results to return (default 10, max 25).', { min: 1, max: 25 }),
        branch: str('Restrict to blobs on this branch.'),
      }, ['snippet']),
    },
    run: async (args) => {
      const snippet = strArg(args, 'snippet')
      if (!snippet) return errorResult('code_search requires a non-empty "snippet" argument')
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const { provider, embedding } = await embedFor(snippet, true)
      const results = vectorSearch(embedding, { topK, searchChunks: true, searchSymbols: true, model: provider.model, branch: strArg(args, 'branch') })
      return { snippet, results: results.map((r) => ({ paths: r.paths, score: r.score, blobHash: r.blobHash })) }
    },
  },
  search_history: {
    category: 'search',
    needsIndex: true,
    definition: {
      name: 'search_history',
      description: 'Semantic search enriched with first-seen date and commit, optionally sorted by date.',
      parameters: obj({
        query: str('Natural-language query to embed and search for.'),
        top_k: int('Maximum number of results to return (default 10, max 25).', { min: 1, max: 25 }),
        before: str('Only include blobs first seen before this date (YYYY-MM-DD).'),
        after: str('Only include blobs first seen after this date (YYYY-MM-DD).'),
        sort_by_date: bool('Sort results by first-seen date (ascending) instead of score.'),
        branch: str('Restrict results to blobs seen on this branch.'),
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('search_history requires a non-empty "query" argument')
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const { embedding } = await embedFor(query)
      let results = vectorSearch(embedding, {
        topK,
        before: dateArg(strArg(args, 'before')),
        after: dateArg(strArg(args, 'after')),
        branch: strArg(args, 'branch'),
      })
      if (boolArg(args, 'sort_by_date')) {
        results = [...results].sort((a, b) => (a.firstSeen ?? Infinity) - (b.firstSeen ?? Infinity))
      }
      return { query, results: results.map((r) => ({ paths: r.paths, score: r.score, blobHash: r.blobHash, firstSeen: r.firstSeen })) }
    },
  },
  first_seen: {
    category: 'search',
    needsIndex: true,
    definition: {
      name: 'first_seen',
      description: 'Find when a concept first appeared in the codebase (results sorted earliest-first).',
      parameters: obj({
        query: str('Natural-language query describing the concept to search for.'),
        top_k: int('Maximum number of results to return (default 10, max 25).', { min: 1, max: 25 }),
        hybrid: bool('Blend vector similarity with BM25 keyword matching.'),
        branch: str('Restrict results to blobs seen on this branch.'),
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('first_seen requires a non-empty "query" argument')
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const branch = strArg(args, 'branch')
      const { embedding } = await embedFor(query)
      const results = boolArg(args, 'hybrid')
        ? hybridSearch(query, embedding, { topK, branch })
        : vectorSearch(embedding, { topK, branch })
      const sorted = [...results].sort((a, b) => (a.firstSeen ?? Infinity) - (b.firstSeen ?? Infinity))
      return {
        query,
        results: sorted.map((r) => ({ paths: r.paths, score: r.score, blobHash: r.blobHash, firstSeen: r.firstSeen })),
      }
    },
  },
  multi_repo_search: {
    category: 'search',
    needsIndex: true,
    definition: {
      name: 'multi_repo_search',
      description: 'Search across multiple registered gitsema repos (registered via `gitsema repos add`).',
      parameters: obj({
        query: str('Natural-language query.'),
        repo_ids: { type: 'array', items: { type: 'string' }, description: 'Repo IDs to search (default: all registered repos with db_path).' },
        top_k: int('Max results (default 10, max 25).', { min: 1, max: 25 }),
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('multi_repo_search requires a non-empty "query" argument')
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const { embedding } = await embedFor(query)
      const session = getActiveSession()
      const repoIds = Array.isArray(args.repo_ids) ? args.repo_ids.filter((x): x is string => typeof x === 'string') : undefined
      const results = await multiRepoSearch(session, Array.from(embedding), { repoIds, topK })
      return { query, results: results.map((r) => ({ repoId: r.repoId, score: r.score, path: r.paths?.[0] ?? r.blobHash.slice(0, 8) })) }
    },
  },

  // -------------------------------------------------------------------------
  // History & temporal drift
  // -------------------------------------------------------------------------
  file_evolution: {
    category: 'history',
    needsIndex: true,
    definition: {
      name: 'file_evolution',
      description: "Track a single file's semantic drift across its Git history.",
      parameters: obj({
        path: str('File path relative to the repo root, e.g. "src/auth/oauth.ts".'),
        threshold: { type: 'number', description: 'Cosine distance threshold above which a version is flagged as a large change (default 0.3).' },
      }, ['path']),
    },
    run: (args) => {
      const path = strArg(args, 'path')
      if (!path) return errorResult('file_evolution requires a non-empty "path" argument')
      const threshold = typeof args.threshold === 'number' ? args.threshold : 0.3
      const entries = computeEvolution(path)
      if (entries.length === 0) return errorResult(`no history found for: ${path}`)
      return {
        path,
        versions: entries.length,
        threshold,
        timeline: entries.map((e, i) => ({
          index: i,
          date: new Date(e.timestamp * 1000).toISOString().slice(0, 10),
          blobHash: e.blobHash,
          commitHash: e.commitHash,
          distFromPrev: e.distFromPrev,
          distFromOrigin: e.distFromOrigin,
          isLargeChange: i > 0 && e.distFromPrev >= threshold,
        })),
      }
    },
  },
  concept_evolution: {
    category: 'history',
    needsIndex: true,
    definition: {
      name: 'concept_evolution',
      description: 'Show how a semantic concept has evolved across the entire commit history.',
      parameters: obj({
        query: str('Natural-language concept to trace, e.g. "authentication".'),
        top_k: int('Number of top-matching blobs to include (default 50).', { min: 1, max: 100 }),
        threshold: { type: 'number', description: 'Cosine distance threshold above which a step is flagged as a large change (default 0.3).' },
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('concept_evolution requires a non-empty "query" argument')
      const topK = numArg(args, 'top_k', 50, 1, 100)
      const threshold = typeof args.threshold === 'number' ? args.threshold : 0.3
      const { embedding } = await embedFor(query)
      const entries = computeConceptEvolution(embedding, topK)
      if (entries.length === 0) return errorResult(`no matching blobs found for: "${query}"`)
      return {
        query,
        entries: entries.length,
        threshold,
        timeline: entries.map((e, i) => ({
          index: i,
          date: new Date(e.timestamp * 1000).toISOString().slice(0, 10),
          blobHash: e.blobHash,
          paths: e.paths,
          score: e.score,
          distFromPrev: e.distFromPrev,
          isLargeChange: i > 0 && e.distFromPrev >= threshold,
        })),
      }
    },
  },
  change_points: {
    category: 'history',
    needsIndex: true,
    definition: {
      name: 'change_points',
      description: 'Find the historical moments when a semantic concept underwent its largest shifts across the codebase.',
      parameters: obj({
        query: str('Natural-language concept to track.'),
        top_k: int('Number of top-matching blobs to scan (default 50).', { min: 1, max: 100 }),
        threshold: { type: 'number', description: 'Cosine distance threshold for flagging a change point (default 0.3).' },
        top_points: int('Number of change points to return (default 5).', { min: 1, max: 25 }),
        branch: str('Restrict to blobs seen on this branch.'),
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('change_points requires a non-empty "query" argument')
      const topK = numArg(args, 'top_k', 50, 1, 100)
      const topPoints = numArg(args, 'top_points', 5, 1, 25)
      const threshold = typeof args.threshold === 'number' ? args.threshold : 0.3
      const { embedding } = await embedFor(query)
      const report = computeConceptChangePoints(query, embedding, { topK, threshold, topPoints, branch: strArg(args, 'branch') })
      return {
        query,
        threshold,
        points: report.points.map((p) => ({
          distance: p.distance,
          before: { commit: p.before.commit, date: p.before.date, paths: p.before.topPaths },
          after: { commit: p.after.commit, date: p.after.date, paths: p.after.topPaths },
        })),
      }
    },
  },
  file_change_points: {
    category: 'history',
    needsIndex: true,
    definition: {
      name: 'file_change_points',
      description: "Detect semantic change points in a single file's Git history.",
      parameters: obj({
        path: str('File path to analyze.'),
        threshold: { type: 'number', description: 'Cosine distance threshold to emit a change point (default 0.3).' },
        top_points: int('Number of change points to return (default 5).', { min: 1, max: 25 }),
        branch: str('Restrict to this branch.'),
      }, ['path']),
    },
    run: (args) => {
      const path = strArg(args, 'path')
      if (!path) return errorResult('file_change_points requires a non-empty "path" argument')
      const threshold = typeof args.threshold === 'number' ? args.threshold : 0.3
      const topPoints = numArg(args, 'top_points', 5, 1, 25)
      const report = computeFileChangePoints(path, { threshold, topPoints, branch: strArg(args, 'branch') })
      return {
        path,
        threshold,
        points: report.points.map((p) => ({
          distance: p.distance,
          before: { blobHash: p.before.blobHash, date: p.before.date },
          after: { blobHash: p.after.blobHash, date: p.after.date },
        })),
      }
    },
  },
  health_timeline: {
    category: 'history',
    needsIndex: true,
    definition: {
      name: 'health_timeline',
      description: 'Time-bucketed codebase health metrics: active blob count, semantic churn rate, and dead-concept ratio.',
      parameters: obj({
        buckets: int('Number of time buckets (default 12).', { min: 1, max: 50 }),
        branch: str('Restrict to commits on this branch.'),
      }),
    },
    run: (args) => {
      const buckets = numArg(args, 'buckets', 12, 1, 50)
      const session = getActiveSession()
      const snaps = computeHealthTimeline(session, { buckets, branch: strArg(args, 'branch') })
      return {
        buckets: snaps.map((s) => ({
          periodStart: new Date(s.periodStart * 1000).toISOString().slice(0, 10),
          periodEnd: new Date(s.periodEnd * 1000).toISOString().slice(0, 10),
          activeBlobCount: s.activeBlobCount,
          semanticChurnRate: s.semanticChurnRate,
          deadConceptRatio: s.deadConceptRatio,
        })),
      }
    },
  },

  // -------------------------------------------------------------------------
  // Branch & merge analysis
  // -------------------------------------------------------------------------
  branch_summary: {
    category: 'branch',
    needsIndex: true,
    definition: {
      name: 'branch_summary',
      description: 'Generate a semantic summary of what a branch is about compared to its base branch.',
      parameters: obj({
        branch: str('Branch to summarise (short name, e.g. "feature/auth").'),
        base_branch: str('Base branch to compare against (default "main").'),
        top_concepts: int('Number of nearest concept clusters to return (default 5).', { min: 1, max: 25 }),
      }, ['branch']),
    },
    run: async (args) => {
      const branch = strArg(args, 'branch')
      if (!branch) return errorResult('branch_summary requires a non-empty "branch" argument')
      const baseBranch = strArg(args, 'base_branch') ?? 'main'
      const topConcepts = numArg(args, 'top_concepts', 5, 1, 25)
      const result = await computeBranchSummary(branch, baseBranch, { topConcepts })
      return {
        branch: result.branch,
        baseBranch: result.baseBranch,
        mergeBase: result.mergeBase,
        exclusiveBlobCount: result.exclusiveBlobCount,
        nearestConcepts: result.nearestConcepts,
        topChangedPaths: result.topChangedPaths,
      }
    },
  },
  merge_audit: {
    category: 'branch',
    needsIndex: true,
    definition: {
      name: 'merge_audit',
      description: "Detect semantic collisions between two branches — pairs of files about the same concept even without shared lines.",
      parameters: obj({
        branch_a: str('First branch name (e.g. "feature/auth").'),
        branch_b: str('Second branch name (e.g. "feature/payments").'),
        threshold: { type: 'number', description: 'Cosine similarity threshold for a collision (0-1, default 0.85).' },
        top_k: int('Maximum collision pairs to return (default 20).', { min: 1, max: 50 }),
      }, ['branch_a', 'branch_b']),
    },
    run: async (args) => {
      const branchA = strArg(args, 'branch_a')
      const branchB = strArg(args, 'branch_b')
      if (!branchA || !branchB) return errorResult('merge_audit requires "branch_a" and "branch_b" arguments')
      const threshold = typeof args.threshold === 'number' ? args.threshold : 0.85
      const topK = numArg(args, 'top_k', 20, 1, 50)
      const { getMergeBase, getBranchExclusiveBlobs } = await import('../git/branchDiff.js')
      const mergeBase = getMergeBase(branchA, branchB)
      const blobsA = getBranchExclusiveBlobs(branchA, mergeBase)
      const blobsB = getBranchExclusiveBlobs(branchB, mergeBase)
      const report = computeSemanticCollisions(blobsA, blobsB, branchA, branchB, mergeBase, { threshold, topK })
      return {
        branchA: report.branchA,
        branchB: report.branchB,
        mergeBase: report.mergeBase,
        blobCountA: report.blobCountA,
        blobCountB: report.blobCountB,
        centroidSimilarity: report.centroidSimilarity,
        collisionZones: report.collisionZones,
        collisionPairs: report.collisionPairs.slice(0, 10).map((p) => ({
          similarity: p.similarity,
          pathA: p.blobA.paths[0] ?? p.blobA.hash.slice(0, 8),
          pathB: p.blobB.paths[0] ?? p.blobB.hash.slice(0, 8),
        })),
      }
    },
  },
  merge_preview: {
    category: 'branch',
    needsIndex: true,
    definition: {
      name: 'merge_preview',
      description: 'Predict how the semantic concept landscape will shift after merging a branch.',
      parameters: obj({
        branch: str('Branch to merge (e.g. "feature/auth").'),
        into: str('Target branch to merge into (default "main").'),
        k: int('Number of semantic clusters to compute (default 8).', { min: 2, max: 25 }),
      }, ['branch']),
    },
    run: async (args) => {
      const branch = strArg(args, 'branch')
      if (!branch) return errorResult('merge_preview requires a non-empty "branch" argument')
      const into = strArg(args, 'into') ?? 'main'
      const k = numArg(args, 'k', 8, 2, 25)
      const report = await computeMergeImpact(branch, into, { k })
      return {
        before: { totalBlobs: report.before.totalBlobs },
        after: { totalBlobs: report.after.totalBlobs },
        newBlobsTotal: report.newBlobsTotal,
        removedBlobsTotal: report.removedBlobsTotal,
        movedBlobsTotal: report.movedBlobsTotal,
        stableBlobsTotal: report.stableBlobsTotal,
        changes: report.changes.map((c) => ({
          label: c.afterCluster?.label ?? c.beforeCluster?.label ?? '(unknown)',
          status: c.afterCluster && c.beforeCluster ? 'changed' : c.afterCluster ? 'new' : 'dissolved',
          centroidDrift: c.centroidDrift,
          newBlobs: c.newBlobs,
          stable: c.stable,
        })),
      }
    },
  },

  // -------------------------------------------------------------------------
  // Ownership & expertise
  // -------------------------------------------------------------------------
  author: {
    category: 'ownership',
    needsIndex: true,
    definition: {
      name: 'author',
      description: 'Find which authors have contributed most to a semantic concept in the codebase.',
      parameters: obj({
        query: str('Natural-language concept to attribute.'),
        top_k: int('Number of top blobs to attribute (default 50).', { min: 1, max: 100 }),
        top_authors: int('Number of top authors to return (default 10).', { min: 1, max: 25 }),
        branch: str('Restrict to blobs seen on this branch.'),
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('author requires a non-empty "query" argument')
      const topK = numArg(args, 'top_k', 50, 1, 100)
      const topAuthors = numArg(args, 'top_authors', 10, 1, 25)
      const { embedding } = await embedFor(query)
      const contributions = await computeAuthorContributions(embedding, { topK, topAuthors, branch: strArg(args, 'branch') })
      return {
        query,
        authors: contributions.map((c) => ({ name: c.authorName, email: c.authorEmail, totalScore: c.totalScore, blobCount: c.blobCount })),
      }
    },
  },
  experts: {
    category: 'ownership',
    needsIndex: true,
    definition: {
      name: 'experts',
      description: 'List top contributors by semantic area (which concepts/clusters they work on).',
      parameters: obj({
        top_n: int('Number of top contributors to return (default 10).', { min: 1, max: 25 }),
        since: str('Only include activity after this date (YYYY-MM-DD).'),
        until: str('Only include activity before this date (YYYY-MM-DD).'),
        min_blobs: int('Minimum blob count to include a contributor (default 1).', { min: 1 }),
        top_clusters: int('Max semantic clusters per contributor (default 5).', { min: 1, max: 25 }),
      }),
    },
    run: (args) => {
      const topN = numArg(args, 'top_n', 10, 1, 25)
      const minBlobs = numArg(args, 'min_blobs', 1, 1, 1000)
      const topClusters = numArg(args, 'top_clusters', 5, 1, 25)
      const experts = computeExperts({
        topN,
        since: dateArg(strArg(args, 'since')),
        until: dateArg(strArg(args, 'until')),
        minBlobs,
        topClusters,
      })
      return {
        experts: experts.map((e) => ({
          authorName: e.authorName,
          authorEmail: e.authorEmail,
          blobCount: e.blobCount,
          clusters: e.clusters.map((c) => ({ label: c.label, blobCount: c.blobCount, representativePaths: c.representativePaths.slice(0, 2) })),
        })),
      }
    },
  },
  ownership: {
    category: 'ownership',
    needsIndex: true,
    definition: {
      name: 'ownership',
      description: 'Ownership heatmap: ranks authors by their share of touched blobs for a semantic concept.',
      parameters: obj({
        query: str('Natural-language concept query.'),
        top: int('Number of top owners to return (default 5).', { min: 1, max: 25 }),
        window_days: int('Time window for recent activity in days (default 90).', { min: 1 }),
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('ownership requires a non-empty "query" argument')
      const top = numArg(args, 'top', 5, 1, 25)
      const windowDays = numArg(args, 'window_days', 90, 1, 3650)
      const { embedding } = await embedFor(query)
      const heatmap = computeOwnershipHeatmap({ embedding, topK: top, windowDays })
      return { query, owners: heatmap }
    },
  },
  contributor_profile: {
    category: 'ownership',
    needsIndex: true,
    definition: {
      name: 'contributor_profile',
      description: "Show what a contributor specialises in — the top blobs nearest the semantic centroid of all blobs they've touched.",
      parameters: obj({
        author: str('Author name or email (substring match).'),
        top_k: int('Number of blobs to return (default 10).', { min: 1, max: 25 }),
        branch: str('Restrict to blobs on this branch.'),
      }, ['author']),
    },
    run: async (args) => {
      const author = strArg(args, 'author')
      if (!author) return errorResult('contributor_profile requires a non-empty "author" argument')
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const results = await computeContributorProfile(author, { topK, branch: strArg(args, 'branch') })
      return { author, results }
    },
  },

  // -------------------------------------------------------------------------
  // Quality, debt & risk
  // -------------------------------------------------------------------------
  impact: {
    category: 'quality',
    needsIndex: true,
    definition: {
      name: 'impact',
      description: 'Find blobs most semantically coupled to a file — what else will be affected by changing it.',
      parameters: obj({
        file: str('Path to the file to analyse (relative to repo root).'),
        top_k: int('Number of similar blobs to return (default 10).', { min: 1, max: 25 }),
        branch: str('Restrict to blobs seen on this branch.'),
      }, ['file']),
    },
    run: async (args) => {
      const file = strArg(args, 'file')
      if (!file) return errorResult('impact requires a non-empty "file" argument')
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const provider = getTextProvider()
      const report = await computeImpact(file, provider, { topK, branch: strArg(args, 'branch') })
      return {
        file,
        results: report.results.map((n) => ({ paths: n.paths, score: n.score, blobHash: n.blobHash })),
      }
    },
  },
  dead_concepts: {
    category: 'quality',
    needsIndex: true,
    definition: {
      name: 'dead_concepts',
      description: 'Find blobs that existed historically but are no longer reachable from HEAD — deleted or removed concepts.',
      parameters: obj({
        top_k: int('Number of dead blobs to return (default 10).', { min: 1, max: 25 }),
        branch: str('Restrict to blobs seen on this branch.'),
      }),
    },
    run: async (args) => {
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const results = await findDeadConcepts({ topK, branch: strArg(args, 'branch') })
      return {
        results: results.map((r) => ({
          path: r.paths[0] ?? null,
          score: r.score,
          lastSeenDate: r.lastSeenDate !== null ? new Date(r.lastSeenDate * 1000).toISOString().slice(0, 10) : null,
          lastSeenMessage: r.lastSeenMessage,
        })),
      }
    },
  },
  debt_score: {
    category: 'quality',
    needsIndex: true,
    definition: {
      name: 'debt_score',
      description: 'Score blobs by technical debt: isolation, age, and low change frequency.',
      parameters: obj({
        top: int('Number of top-debt blobs to return (default 20).', { min: 1, max: 50 }),
        branch: str('Restrict to blobs on this branch.'),
      }),
    },
    run: async (args) => {
      const top = numArg(args, 'top', 20, 1, 50)
      const provider = getTextProvider()
      const session = getActiveSession()
      const results = await scoreDebt(session, provider, { top, branch: strArg(args, 'branch'), model: provider.model })
      return {
        results: results.map((r) => ({
          path: r.paths[0] ?? null,
          debtScore: r.debtScore,
          isolationScore: r.isolationScore,
          ageScore: r.ageScore,
          changeFrequency: r.changeFrequency,
        })),
      }
    },
  },
  doc_gap: {
    category: 'quality',
    needsIndex: true,
    definition: {
      name: 'doc_gap',
      description: 'Find code blobs with insufficient documentation coverage vs. prose/docs blobs in the index.',
      parameters: obj({
        top_k: int('Number of underdocumented blobs to return (default 20).', { min: 1, max: 50 }),
        threshold: { type: 'number', description: 'Maximum doc-similarity to include (lower = less documented).' },
        branch: str('Restrict to blobs on this branch.'),
      }),
    },
    run: async (args) => {
      const topK = numArg(args, 'top_k', 20, 1, 50)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const results = await computeDocGap({ topK, threshold, branch: strArg(args, 'branch') })
      return { results: results.map((r) => ({ path: r.paths[0] ?? r.blobHash.slice(0, 8), maxDocSimilarity: r.maxDocSimilarity })) }
    },
  },
  security_scan: {
    category: 'quality',
    needsIndex: true,
    definition: {
      name: 'security_scan',
      description: 'Scan the codebase for blobs semantically similar to common vulnerability patterns. Results are similarity scores, NOT confirmed vulnerabilities.',
      parameters: obj({
        top: int('Number of results per pattern (default 10).', { min: 1, max: 25 }),
      }),
    },
    run: async (args) => {
      const top = numArg(args, 'top', 10, 1, 25)
      const provider = getTextProvider()
      const session = getActiveSession()
      const findings = await scanForVulnerabilities(session, provider, { top })
      return {
        warning: 'similarity scores only — NOT confirmed vulnerabilities, manual review required',
        findings: findings.map((f) => ({ pattern: f.patternName, score: f.score, path: f.paths[0] ?? null, blobHash: f.blobHash })),
      }
    },
  },

  // -------------------------------------------------------------------------
  // Diff & blame
  // -------------------------------------------------------------------------
  semantic_diff: {
    category: 'diff',
    needsIndex: true,
    definition: {
      name: 'semantic_diff',
      description: 'Compute a conceptual/semantic diff of a topic across two git refs — shows gained, lost, and stable concepts.',
      parameters: obj({
        ref1: str('Earlier git ref (branch, tag, commit hash, or date).'),
        ref2: str('Later git ref.'),
        query: str('Topic query to embed and compare.'),
        top_k: int('Number of results per category (default 10).', { min: 1, max: 25 }),
        branch: str('Restrict to blobs seen on this branch.'),
      }, ['ref1', 'ref2', 'query']),
    },
    run: async (args) => {
      const ref1 = strArg(args, 'ref1')
      const ref2 = strArg(args, 'ref2')
      const query = strArg(args, 'query')
      if (!ref1 || !ref2 || !query) return errorResult('semantic_diff requires "ref1", "ref2", and "query" arguments')
      const topK = numArg(args, 'top_k', 10, 1, 25)
      const { embedding } = await embedFor(query)
      const result = computeSemanticDiff(embedding, query, ref1, ref2, topK, strArg(args, 'branch'))
      const render = (list: typeof result.gained) => list.map((e) => ({ path: e.paths[0] ?? null, blobHash: e.blobHash, score: e.score, firstSeen: e.firstSeen }))
      return {
        topic: result.topic,
        ref1: result.ref1,
        ref2: result.ref2,
        gained: render(result.gained),
        lost: render(result.lost),
        stable: render(result.stable),
      }
    },
  },
  semantic_blame: {
    category: 'diff',
    needsIndex: true,
    definition: {
      name: 'semantic_blame',
      description: 'Show the semantic origin of each logical block in a file — finds nearest-neighbor blobs in the index.',
      parameters: obj({
        file_path: str('Path to the file to blame.'),
        top_k: int('Neighbors per block (default 3).', { min: 1, max: 10 }),
        level: { type: 'string', enum: ['file', 'symbol'], description: 'Granularity level (default "file").' },
        branch: str('Restrict to blobs seen on this branch.'),
      }, ['file_path']),
    },
    run: async (args) => {
      const filePath = strArg(args, 'file_path')
      if (!filePath) return errorResult('semantic_blame requires a non-empty "file_path" argument')
      const topK = numArg(args, 'top_k', 3, 1, 10)
      const level = strArg(args, 'level') === 'symbol' ? 'symbol' : 'file'
      const content = readHeadFile(filePath)
      if (!content) return errorResult(`could not read file at HEAD: ${filePath}`)
      const provider = getTextProvider()
      const entries = await computeSemanticBlame(filePath, content, provider, { topK, searchSymbols: level === 'symbol', branch: strArg(args, 'branch') })
      return {
        filePath,
        blocks: entries.map((e) => ({
          label: e.label,
          startLine: e.startLine,
          endLine: e.endLine,
          neighbors: e.neighbors.map((n) => ({ similarity: n.similarity, path: n.paths[0] ?? null, blobHash: n.blobHash, commitHash: n.commitHash, author: n.author })),
        })),
      }
    },
  },

  // -------------------------------------------------------------------------
  // Clustering
  // -------------------------------------------------------------------------
  clusters: {
    category: 'clusters',
    needsIndex: true,
    definition: {
      name: 'clusters',
      description: 'Cluster all indexed blobs into K semantic groups using k-means and return labels, sizes, and representative paths.',
      parameters: obj({
        k: int('Number of clusters to compute (default 8).', { min: 2, max: 25 }),
        branch: str('Restrict clustering to blobs seen on this branch.'),
      }),
    },
    run: async (args) => {
      const k = numArg(args, 'k', 8, 2, 25)
      const branch = strArg(args, 'branch')
      const blobHashFilter = branch ? getBlobHashesOnBranch(branch) : undefined
      const report = await computeClusters({ k, blobHashFilter })
      return {
        k: report.k,
        totalBlobs: report.totalBlobs,
        clusters: report.clusters.map((c) => ({ id: c.id, label: c.label, size: c.size, keywords: c.topKeywords, representativePaths: c.representativePaths.slice(0, 3) })),
      }
    },
  },
  cluster_diff: {
    category: 'clusters',
    needsIndex: true,
    definition: {
      name: 'cluster_diff',
      description: 'Compare semantic clusters between two points in history.',
      parameters: obj({
        ref1: str('Earlier git ref.'),
        ref2: str('Later git ref.'),
        k: int('Number of clusters to compute (default 8).', { min: 2, max: 25 }),
      }, ['ref1', 'ref2']),
    },
    run: async (args) => {
      const ref1 = strArg(args, 'ref1')
      const ref2 = strArg(args, 'ref2')
      if (!ref1 || !ref2) return errorResult('cluster_diff requires "ref1" and "ref2" arguments')
      const k = numArg(args, 'k', 8, 2, 25)
      const ts1 = resolveRefToTimestamp(ref1)
      const ts2 = resolveRefToTimestamp(ref2)
      const snapshot1 = await computeClusterSnapshot({ k, blobHashFilter: getBlobHashesUpTo(ts1) })
      const snapshot2 = await computeClusterSnapshot({ k, blobHashFilter: getBlobHashesUpTo(ts2) })
      return compareClusterSnapshots(snapshot1, snapshot2, ref1, ref2)
    },
  },
  cluster_timeline: {
    category: 'clusters',
    needsIndex: true,
    definition: {
      name: 'cluster_timeline',
      description: 'Track how semantic clusters evolve through commit history.',
      parameters: obj({
        since: str('Start date or git-recognized date expression.'),
        until: str('End date or git-recognized date expression.'),
        k: int('Number of clusters per step (default 4).', { min: 2, max: 16 }),
        branch: str('Restrict to commits on this branch.'),
      }),
    },
    run: async (args) => {
      const k = numArg(args, 'k', 4, 2, 16)
      const opts: { k: number; since?: number; until?: number; branch?: string } = { k }
      const since = dateArg(strArg(args, 'since'))
      const until = dateArg(strArg(args, 'until'))
      if (since !== undefined) opts.since = since
      if (until !== undefined) opts.until = until
      const branch = strArg(args, 'branch')
      if (branch) opts.branch = branch
      return computeClusterTimeline(opts)
    },
  },

  // -------------------------------------------------------------------------
  // Compound workflows
  // -------------------------------------------------------------------------
  triage: {
    category: 'workflow',
    needsIndex: true,
    definition: {
      name: 'triage',
      description: 'Incident/issue triage bundle: first-seen, change points, experts, and optional file evolution for a query.',
      parameters: obj({
        query: str('Natural-language query describing the issue or incident.'),
        top: int('Max results per section (default 5).', { min: 1, max: 25 }),
        file: str('Optional file path for file-level evolution analysis.'),
      }, ['query']),
    },
    run: async (args) => {
      const query = strArg(args, 'query')
      if (!query) return errorResult('triage requires a non-empty "query" argument')
      const top = numArg(args, 'top', 5, 1, 25)
      const { embedding } = await embedFor(query)
      const sections: Record<string, unknown> = {}
      try { sections.firstSeen = vectorSearch(embedding, { topK: top }).map((r) => ({ path: r.paths[0] ?? null, score: r.score, blobHash: r.blobHash, firstSeen: r.firstSeen })) } catch { sections.firstSeen = [] }
      try { sections.changePoints = computeConceptChangePoints(query, embedding, { topK: top }).points } catch { sections.changePoints = [] }
      try { sections.experts = computeExperts({ topN: top }) } catch { sections.experts = [] }
      const file = strArg(args, 'file')
      if (file) {
        try { sections.fileEvolution = computeEvolution(file).slice(0, 20) } catch { sections.fileEvolution = [] }
      }
      return { query, ...sections }
    },
  },
  workflow_run: {
    category: 'workflow',
    needsIndex: true,
    definition: {
      name: 'workflow_run',
      description: 'Run a named workflow template (pr-review | incident | release-audit) and return all sections of the analysis bundle.',
      parameters: obj({
        template: { type: 'string', enum: ['pr-review', 'incident', 'release-audit'], description: 'Workflow template to run.' },
        query: str('Query string (required for incident and release-audit).'),
        file: str('File path (used by pr-review for impact analysis).'),
        top: int('Max results per section (default 5).', { min: 1, max: 25 }),
      }, ['template']),
    },
    run: async (args) => {
      const template = strArg(args, 'template')
      if (!template || !['pr-review', 'incident', 'release-audit'].includes(template)) {
        return errorResult('workflow_run requires "template" to be one of pr-review | incident | release-audit')
      }
      const top = numArg(args, 'top', 5, 1, 25)
      const query = strArg(args, 'query')
      const file = strArg(args, 'file')
      const sections: Record<string, unknown> = {}

      if (template === 'pr-review') {
        const q = query ?? file ?? 'code changes'
        const { embedding } = await embedFor(q)
        if (file) {
          try {
            const provider = getTextProvider()
            const report = await computeImpact(file, provider, { topK: top })
            sections.impact = report.results.map((n) => ({ path: n.paths[0] ?? null, score: n.score, blobHash: n.blobHash }))
          } catch { sections.impact = [] }
        }
        try { sections.changePoints = computeConceptChangePoints(q, embedding, { topK: top }).points } catch { sections.changePoints = [] }
        try { sections.experts = computeExperts({ topN: top }) } catch { sections.experts = [] }
      } else if (template === 'incident') {
        const q = query ?? ''
        const { embedding } = await embedFor(q)
        try { sections.firstSeen = vectorSearch(embedding, { topK: top }).map((r) => ({ path: r.paths[0] ?? null, score: r.score, blobHash: r.blobHash, firstSeen: r.firstSeen })) } catch { sections.firstSeen = [] }
        try { sections.changePoints = computeConceptChangePoints(q, embedding, { topK: top }).points } catch { sections.changePoints = [] }
        try { sections.experts = computeExperts({ topN: top }) } catch { sections.experts = [] }
      } else {
        const q = query ?? 'architecture changes quality'
        const { embedding } = await embedFor(q)
        try { sections.topChangedConcepts = vectorSearch(embedding, { topK: top }).map((r) => ({ path: r.paths[0] ?? null, score: r.score, blobHash: r.blobHash })) } catch { sections.topChangedConcepts = [] }
        try { sections.changePoints = computeConceptChangePoints(q, embedding, { topK: top }).points } catch { sections.changePoints = [] }
        try { sections.experts = computeExperts({ topN: top }) } catch { sections.experts = [] }
      }

      return { template, ...sections }
    },
  },
  policy_check: {
    category: 'workflow',
    needsIndex: true,
    definition: {
      name: 'policy_check',
      description: 'CI policy gate: check index health against thresholds for debt score, security similarity, and concept drift. Returns pass/fail for each gate.',
      parameters: obj({
        max_debt_score: { type: 'number', description: 'Fail if average debt score exceeds this threshold (0-1).' },
        min_security_score: { type: 'number', description: 'Fail if max security similarity exceeds this threshold (0-1).' },
        max_drift: { type: 'number', description: 'Fail if max concept drift distance exceeds this threshold (0-2, requires query).' },
        query: str('Query for drift analysis (required when max_drift is set).'),
      }),
    },
    run: async (args) => {
      const provider = getTextProvider()
      const session = getActiveSession()
      const results: { passed: boolean; checks: Record<string, unknown> } = { passed: true, checks: {} }

      const maxDebtScore = typeof args.max_debt_score === 'number' ? args.max_debt_score : undefined
      if (maxDebtScore !== undefined) {
        const debtItems = await scoreDebt(session, provider)
        const avgScore = debtItems.length > 0 ? debtItems.reduce((s, r) => s + r.debtScore, 0) / debtItems.length : 0
        const passed = avgScore <= maxDebtScore
        results.checks.debt = { avgScore, threshold: maxDebtScore, passed }
        if (!passed) results.passed = false
      }

      const minSecurityScore = typeof args.min_security_score === 'number' ? args.min_security_score : undefined
      if (minSecurityScore !== undefined) {
        const findings = await scanForVulnerabilities(session, provider)
        const maxSim = findings.length > 0 ? Math.max(...findings.map((f) => f.score)) : 0
        const passed = maxSim <= minSecurityScore
        results.checks.security = { maxSimilarity: maxSim, threshold: minSecurityScore, passed }
        if (!passed) results.passed = false
      }

      const maxDrift = typeof args.max_drift === 'number' ? args.max_drift : undefined
      const query = strArg(args, 'query')
      if (maxDrift !== undefined && query) {
        const { embedding } = await embedFor(query)
        const cps = computeConceptChangePoints(query, embedding, { topK: 50 })
        const maxDist = cps.points.length > 0 ? Math.max(...cps.points.map((c) => c.distance)) : 0
        const passed = maxDist <= maxDrift
        results.checks.drift = { maxDistance: maxDist, threshold: maxDrift, passed }
        if (!passed) results.passed = false
      }

      return results
    },
  },
  eval: {
    category: 'workflow',
    needsIndex: true,
    definition: {
      name: 'eval',
      description: 'Retrieval evaluation harness: given (query, expected paths) test cases, returns precision@k, recall@k, and MRR for the current index.',
      parameters: obj({
        cases: {
          type: 'array',
          items: obj({ query: str('Search query.'), expected_paths: { type: 'array', items: { type: 'string' }, description: 'Expected file paths in the top-k results.' } }, ['query', 'expected_paths']),
          description: 'Evaluation test cases.',
        },
        top: int('k for P@k / R@k (default 10).', { min: 1, max: 25 }),
      }, ['cases']),
    },
    run: async (args) => {
      const cases = Array.isArray(args.cases) ? args.cases as Array<{ query: string; expected_paths: string[] }> : []
      if (cases.length === 0) return errorResult('eval requires a non-empty "cases" array')
      const top = numArg(args, 'top', 10, 1, 25)
      let sumPrecision = 0, sumRecall = 0, sumMrr = 0
      const caseResults: Array<{ query: string; precision: number; recall: number; mrr: number }> = []
      for (const c of cases) {
        const { embedding } = await embedFor(c.query)
        const hits = vectorSearch(embedding, { topK: top })
        const topPaths = hits.flatMap((h) => h.paths ?? []).slice(0, top)
        const expected = new Set(c.expected_paths)
        const matched = topPaths.filter((p) => expected.has(p))
        const precision = topPaths.length > 0 ? matched.length / topPaths.length : 0
        const recall = expected.size > 0 ? matched.length / expected.size : 1
        let mrr = 0
        for (let i = 0; i < topPaths.length; i++) { if (expected.has(topPaths[i])) { mrr = 1 / (i + 1); break } }
        sumPrecision += precision; sumRecall += recall; sumMrr += mrr
        caseResults.push({ query: c.query, precision, recall, mrr })
      }
      const n = cases.length
      return {
        top,
        aggregate: { precisionAtK: sumPrecision / n, recallAtK: sumRecall / n, mrr: sumMrr / n },
        cases: caseResults,
      }
    },
  },

  // -------------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------------
  index: {
    category: 'admin',
    needsIndex: false,
    definition: {
      name: 'index',
      description: 'Index (or incrementally re-index) the Git repository at the current working directory. This is a WRITE operation that embeds blobs — only run it when the index is missing or stale.',
      parameters: obj({
        since: str('Only index commits after this point; a date, tag, commit hash, or "all" to force a full re-index.'),
        concurrency: int('Number of blobs to embed concurrently (default 4).', { min: 1, max: 16 }),
      }),
    },
    run: async (args) => {
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, textModel)
      const stats = await runIndex({
        repoPath: '.',
        provider,
        since: strArg(args, 'since'),
        concurrency: numArg(args, 'concurrency', 4, 1, 16),
        maxBlobSize: DEFAULT_MAX_SIZE,
      })
      return stats
    },
  },
}

// ---------------------------------------------------------------------------
// Derived definitions + plain data helpers
// ---------------------------------------------------------------------------

export const GUIDE_TOOL_DEFINITIONS: ToolDefinition[] = Object.values(GUIDE_TOOLS).map((e) => e.definition)

/** Raw repo-stats data (branches/tags/commits/remotes). */
export function repoStatsData(): { branches: number; tags: number; commits: number; remotes: string[] } {
  const countLines = (cmd: string): number => {
    try {
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      return out ? out.split('\n').filter(Boolean).length : 0
    } catch {
      return 0
    }
  }
  const branches = countLines('git branch --list')
  const tags = countLines('git tag --list')
  let commits = 0
  try {
    commits = parseInt(execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 10) || 0
  } catch {
    commits = 0
  }
  let remotes: string[] = []
  try {
    remotes = execSync('git remote -v', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean).slice(0, 4)
  } catch {
    remotes = []
  }
  return { branches, tags, commits, remotes }
}

/** Raw recent-commits data (hash/date/subject), most recent first. */
export function recentCommitsData(n = 20): { commits: Array<{ hash: string; date: string; subject: string }> } {
  try {
    const raw = execSync(`git log --max-count=${n} --format=%H%x1F%ai%x1F%s%x1E`, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    }).trim()
    const commits = raw
      .split('\x1E')
      .map((rec) => rec.trim())
      .filter(Boolean)
      .map((rec) => {
        const [hash, date, subject] = rec.split('\x1F')
        return { hash: hash?.trim() ?? '', date: date?.trim() ?? '', subject: subject?.trim() ?? '' }
      })
    return { commits }
  } catch {
    return { commits: [] }
  }
}

/** `repo_stats` as a capped JSON string (back-compat helper used by guide.ts context-gathering). */
export function toolRepoStats(): string {
  return toCappedJson(repoStatsData())
}

/** `recent_commits` as a capped JSON string (used by guide.ts context-gathering). */
export function toolRecentCommits(n = 20): string {
  return toCappedJson(recentCommitsData(n))
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * Execute a single tool call by name. Always resolves to a string (never
 * throws) — unknown tools and per-tool errors are returned as structured
 * `{ error: ... }` JSON so the agent loop can feed them back to the LLM.
 */
export async function executeTool(call: ToolCall): Promise<string> {
  const { name, arguments: args } = call
  const entry = GUIDE_TOOLS[name]
  if (!entry) return toCappedJson(errorResult(`unknown tool: ${name}`))

  if (entry.needsIndex) {
    const indexError = requireIndex()
    if (indexError) return toCappedJson(indexError)
  }

  try {
    const result = await entry.run(args)
    return toCappedJson(result)
  } catch (err) {
    logger.warn(`[guideTools] tool "${name}" threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`)
    return toCappedJson(errorResult(`tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`))
  }
}

// fetchCommitEvents is re-exported for callers that build context outside the
// agent loop (e.g. CLI guide command's gatherContext).
export { fetchCommitEvents }
