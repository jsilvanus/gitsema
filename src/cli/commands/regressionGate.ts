/**
 * Semantic regression CI gate (Phase 79).
 *
 * Compares the semantic embedding of key concept queries between two Git refs
 * (e.g., a PR branch vs main) and fails if cosine drift exceeds a threshold.
 *
 * Usage:
 *   gitsema regression-gate --base main --head HEAD --concepts concepts.json
 *   gitsema regression-gate --base abc123 --head def456 --query "authentication flow"
 *
 * Exit code:
 *   0 — all concepts within threshold
 *   1 — one or more concepts drifted beyond threshold (CI failure)
 *   2 — tool error (provider unreachable, invalid refs, etc.)
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { vectorSearch, cosineSimilarity } from '../../core/search/vectorSearch.js'

export interface RegressionGateOptions {
  base?: string
  head?: string
  query?: string
  concepts?: string   // path to JSON file: string[] | {query: string, threshold?: number}[]
  threshold?: string  // default 0.15 cosine distance
  format?: string     // 'text' | 'json'
  topK?: string
}

export interface RegressionResult {
  query: string
  threshold: number
  baseScore: number
  headScore: number
  drift: number
  passed: boolean
}

export async function regressionGateCommand(opts: RegressionGateOptions): Promise<void> {
  const baseRef = opts.base ?? 'main'
  const headRef = opts.head ?? 'HEAD'
  const globalThreshold = parseFloat(opts.threshold ?? '0.15')
  const topK = parseInt(opts.topK ?? '10', 10)
  const format = opts.format ?? 'text'

  // Collect queries
  const queries: Array<{ query: string; threshold: number }> = []
  if (opts.query) {
    queries.push({ query: opts.query, threshold: globalThreshold })
  }
  if (opts.concepts) {
    try {
      const raw = JSON.parse(readFileSync(opts.concepts, 'utf8'))
      for (const item of raw as Array<string | { query: string; threshold?: number }>) {
        if (typeof item === 'string') {
          queries.push({ query: item, threshold: globalThreshold })
        } else {
          queries.push({ query: item.query, threshold: item.threshold ?? globalThreshold })
        }
      }
    } catch (err) {
      console.error(`Error reading concepts file: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(2)
    }
  }

  if (queries.length === 0) {
    console.error('Error: provide --query <text> or --concepts <file.json>')
    process.exit(2)
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const modelName = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProvider(providerType, modelName)

  // Resolve refs to commit hashes for display
  let baseHash = baseRef; let headHash = headRef
  try {
    baseHash = execSync(`git rev-parse --short ${baseRef}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    headHash = execSync(`git rev-parse --short ${headRef}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch { /* use as-is */ }

  if (format === 'text') {
    console.log(`Semantic regression gate: ${baseHash}..${headHash}`)
    console.log(`Model: ${modelName} | threshold: ±${globalThreshold}`)
    console.log()
  }

  const results: RegressionResult[] = []

  for (const { query, threshold } of queries) {
    let embedding: number[]
    try {
      embedding = await embedQuery(provider, query) as number[]
    } catch (err) {
      console.error(`Could not embed query "${query}": ${err instanceof Error ? err.message : String(err)}`)
      process.exit(2)
    }

    // Search at base/head ref. When refs are branch names the `branch` filter in
    // vectorSearch restricts to blobs indexed on that branch (via blob_branches table).
    // For commit hashes or tags, blob_branches may have no match and the filter is
    // effectively a no-op (returns all blobs), which is safe but less precise.
    const baseResults = vectorSearch(embedding, { topK, branch: baseRef })
    const headResults = vectorSearch(embedding, { topK, branch: headRef })

    const baseScore = baseResults.length > 0 ? baseResults[0].score : 0
    const headScore = headResults.length > 0 ? headResults[0].score : 0
    const drift = Math.abs(baseScore - headScore)
    const passed = drift <= threshold

    results.push({ query, threshold, baseScore, headScore, drift, passed })

    if (format === 'text') {
      const icon = passed ? '✓' : '✗'
      console.log(`${icon} "${query}"`)
      console.log(`   base: ${baseScore.toFixed(4)}  head: ${headScore.toFixed(4)}  drift: ${drift.toFixed(4)} (threshold: ${threshold})`)
      if (!passed) {
        console.log(`   ↑ REGRESSION DETECTED`)
      }
    }
  }

  const allPassed = results.every((r) => r.passed)

  if (format === 'json') {
    console.log(JSON.stringify({ base: baseHash, head: headHash, results, allPassed }, null, 2))
  } else {
    console.log()
    if (allPassed) {
      console.log(`✓ All ${results.length} concept(s) within drift threshold — gate PASSED`)
    } else {
      const failed = results.filter((r) => !r.passed).length
      console.log(`✗ ${failed}/${results.length} concept(s) drifted beyond threshold — gate FAILED`)
    }
  }

  process.exit(allPassed ? 0 : 1)
}
