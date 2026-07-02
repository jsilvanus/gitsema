/**
 * Core computation for the semantic code-review assistant (Phase 81,
 * extracted to `src/core/search` in Phase 148 so the CLI `code-review`
 * command, the `code_review` MCP tool, and the `POST /insights/code-review`
 * HTTP route all share one implementation instead of duplicating it).
 *
 * Given a unified diff, finds historical analogues for each changed file's
 * added lines and flags a regression-risk heuristic based on how similar
 * the removed lines were to previously-seen code.
 */

import type { EmbeddingProvider } from '../embedding/provider.js'
import { embedQuery } from '../embedding/embedQuery.js'
import { vectorSearch } from './analysis/vectorSearch.js'
import { structuralContextForPath, type StructuralContext } from '../graph/structuralContext.js'
import type { GraphStore } from '../storage/types.js'

export interface HunkSummary {
  file: string
  addedLines: string[]
  removedLines: string[]
}

/** Parses a unified diff (`git diff` / `diff --git` format) into per-file hunks. */
export function parseDiff(diffText: string): HunkSummary[] {
  const hunks: HunkSummary[] = []
  let current: HunkSummary | null = null

  for (const line of diffText.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
    if (line.startsWith('diff --git ')) {
      const match = line.match(/b\/(.+)$/)
      if (match) {
        if (current) hunks.push(current)
        current = { file: match[1], addedLines: [], removedLines: [] }
      }
    } else if (current) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        current.addedLines.push(line.slice(1))
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        current.removedLines.push(line.slice(1))
      }
    }
  }
  if (current) hunks.push(current)
  return hunks
}

export interface CodeReviewEntry {
  file: string
  analogues: Array<{ path: string; score: number }>
  regressionRisk: 'low' | 'medium' | 'high'
  structural?: StructuralContext
}

export interface CodeReviewComputeOptions {
  topK?: number
  threshold?: number
  /** When provided (Phase 110 hybrid/structural lens), enriches each entry with call-graph/co-change context. */
  graph?: GraphStore
}

/**
 * Runs the code-review analysis over already-parsed diff hunks.
 */
export async function computeCodeReview(
  hunks: HunkSummary[],
  provider: EmbeddingProvider,
  options: CodeReviewComputeOptions = {},
): Promise<CodeReviewEntry[]> {
  const topK = options.topK ?? 5
  const threshold = options.threshold ?? 0.75
  const reviews: CodeReviewEntry[] = []

  for (const hunk of hunks) {
    if (hunk.addedLines.length === 0 && hunk.removedLines.length === 0) continue

    const addedText = hunk.addedLines.join('\n').slice(0, 2000)
    if (!addedText.trim()) continue

    let embedding: number[]
    try {
      embedding = await embedQuery(provider, addedText) as number[]
    } catch {
      continue
    }

    const results = await vectorSearch(embedding, { topK, searchChunks: true })
    const analogues = results
      .filter((r) => r.score >= threshold)
      .map((r) => ({ path: r.paths?.[0] ?? r.blobHash.slice(0, 12), score: r.score }))

    let regressionRisk: 'low' | 'medium' | 'high' = 'low'
    if (hunk.removedLines.length > 0 && analogues.length > 0) {
      const removedText = hunk.removedLines.join('\n').slice(0, 2000)
      try {
        const removedEmbedding = await embedQuery(provider, removedText) as number[]
        const removedResults = await vectorSearch(removedEmbedding, { topK: 3 })
        const maxRemovedScore = removedResults[0]?.score ?? 0
        if (maxRemovedScore >= 0.9) regressionRisk = 'high'
        else if (maxRemovedScore >= 0.75) regressionRisk = 'medium'
      } catch { /* ignore */ }
    }

    let structural: StructuralContext | undefined
    if (options.graph) {
      structural = await structuralContextForPath(options.graph, hunk.file)
    }

    reviews.push({ file: hunk.file, analogues, regressionRisk, structural })
  }

  return reviews
}
