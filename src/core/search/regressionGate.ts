/**
 * Core computation for the semantic regression CI gate (Phase 79, extracted
 * to `src/core/search` in Phase 148 so the CLI `regression-gate` command,
 * the `regression_gate` MCP tool, and the `POST /insights/regression-gate`
 * HTTP route all share one implementation instead of duplicating it).
 *
 * Compares the top cosine-similarity score for a set of concept queries
 * between two Git refs (typically a PR branch vs. a base branch) and flags
 * any query whose drift exceeds its threshold.
 */

import type { Embedding } from '../models/types.js'
import { vectorSearch } from './analysis/vectorSearch.js'

export interface RegressionGateQuery {
  query: string
  embedding: Embedding
  threshold: number
}

export interface RegressionGateResult {
  query: string
  threshold: number
  baseScore: number
  headScore: number
  drift: number
  passed: boolean
}

export interface RegressionGateReport {
  baseRef: string
  headRef: string
  results: RegressionGateResult[]
  allPassed: boolean
}

export interface RegressionGateComputeOptions {
  baseRef: string
  headRef: string
  topK?: number
}

/**
 * Compares base/head top-match scores for each pre-embedded query and
 * reports per-query drift plus an overall pass/fail.
 *
 * Search is restricted to blobs seen on `baseRef`/`headRef` via the
 * `branch` filter in `vectorSearch` (backed by `blob_branches`). When a ref
 * is a commit hash/tag rather than a branch name, the filter is typically a
 * no-op (no matching rows), which still returns a safe, if less precise,
 * result — same caveat as the pre-extraction CLI implementation.
 */
export async function computeRegressionGate(
  queries: RegressionGateQuery[],
  options: RegressionGateComputeOptions,
): Promise<RegressionGateReport> {
  const topK = options.topK ?? 10
  const results: RegressionGateResult[] = []

  for (const { query, embedding, threshold } of queries) {
    const baseResults = await vectorSearch(embedding, { topK, branch: options.baseRef })
    const headResults = await vectorSearch(embedding, { topK, branch: options.headRef })

    const baseScore = baseResults.length > 0 ? baseResults[0].score : 0
    const headScore = headResults.length > 0 ? headResults[0].score : 0
    const drift = Math.abs(baseScore - headScore)
    const passed = drift <= threshold

    results.push({ query, threshold, baseScore, headScore, drift, passed })
  }

  const allPassed = results.every((r) => r.passed)
  return { baseRef: options.baseRef, headRef: options.headRef, results, allPassed }
}
