/**
 * `gitsema cross-repo-similarity` — cross-repo concept similarity analysis (Phase 80).
 *
 * Finds the top matching blobs for a query in two separately indexed repos and
 * computes similarity between their results. Useful for detecting shared
 * architectural patterns or concept drift across repositories.
 *
 * Usage:
 *   gitsema cross-repo-similarity "authentication middleware" \
 *     --repo-a ./repoA/.gitsema/index.db \
 *     --repo-b ./repoB/.gitsema/index.db
 */

import { writeFileSync } from 'node:fs'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { openDatabaseAt } from '../../core/db/sqlite.js'
import { vectorSearchWithSession } from '../../core/search/analysis/vectorSearch.js'
import { resolveOutputs, getSink } from '../../utils/outputSink.js'

export interface CrossRepoSimilarityOptions {
  repoA?: string
  repoB?: string
  top?: string
  threshold?: string
  format?: string
  /** Unified output spec (repeatable); --out wins over --format */
  out?: string[]
}

export async function crossRepoSimilarityCommand(
  query: string,
  opts: CrossRepoSimilarityOptions,
): Promise<void> {
  if (!opts.repoA || !opts.repoB) {
    console.error('Error: --repo-a and --repo-b are required (paths to .gitsema/index.db files)')
    process.exit(1)
  }
  const topK = parseInt(opts.top ?? '5', 10)
  const threshold = parseFloat(opts.threshold ?? '0.7')

  // --out wins over --format when present; otherwise --format keeps working unchanged.
  const sinks = opts.out && opts.out.length > 0
    ? resolveOutputs({ out: opts.out })
    : undefined
  const jsonSink = sinks ? getSink(sinks, 'json') : undefined
  const format = sinks ? (jsonSink ? 'json' : 'text') : (opts.format ?? 'text')

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const modelName = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProvider(providerType, modelName)

  let embedding: number[]
  try {
    embedding = await embedQuery(provider, query) as number[]
  } catch (err) {
    console.error(`Could not embed query: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }

  const sessionA = openDatabaseAt(opts.repoA)
  const sessionB = openDatabaseAt(opts.repoB)

  const resultsA = vectorSearchWithSession(sessionA.rawDb, embedding, { topK })
  const resultsB = vectorSearchWithSession(sessionB.rawDb, embedding, { topK })

  sessionA.rawDb.close()
  sessionB.rawDb.close()

  if (format === 'json') {
    const json = JSON.stringify({
      query,
      repoA: { path: opts.repoA, results: resultsA },
      repoB: { path: opts.repoB, results: resultsB },
    }, null, 2)
    if (jsonSink?.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Cross-repo similarity JSON written to: ${jsonSink.file}`)
    } else {
      console.log(json)
    }
    return
  }

  console.log(`Cross-repo concept similarity: "${query}"`)
  console.log(`Model: ${modelName} | similarity threshold: ${threshold}`)
  console.log()

  console.log(`Repo A: ${opts.repoA}`)
  for (const r of resultsA) {
    const path = r.paths?.[0] ?? r.blobHash.slice(0, 12)
    console.log(`  ${r.score.toFixed(4)}  ${path}`)
  }
  if (resultsA.length === 0) console.log('  (no results)')

  console.log()
  console.log(`Repo B: ${opts.repoB}`)
  for (const r of resultsB) {
    const path = r.paths?.[0] ?? r.blobHash.slice(0, 12)
    console.log(`  ${r.score.toFixed(4)}  ${path}`)
  }
  if (resultsB.length === 0) console.log('  (no results)')

  // Cross-match: blobs strongly scoring in both repos suggest shared concept
  const sharedConcepts: Array<{ pathA: string; pathB: string; scoreA: number; scoreB: number }> = []
  for (const ra of resultsA) {
    for (const rb of resultsB) {
      if (ra.score >= threshold && rb.score >= threshold && Math.abs(ra.score - rb.score) <= 0.05) {
        sharedConcepts.push({
          pathA: ra.paths?.[0] ?? ra.blobHash.slice(0, 12),
          pathB: rb.paths?.[0] ?? rb.blobHash.slice(0, 12),
          scoreA: ra.score,
          scoreB: rb.score,
        })
      }
    }
  }

  if (sharedConcepts.length > 0) {
    console.log()
    console.log(`Shared concept matches (score ≥ ${threshold}):`)
    for (const sc of sharedConcepts) {
      console.log(`  A: ${sc.pathA} (${sc.scoreA.toFixed(4)})  ↔  B: ${sc.pathB} (${sc.scoreB.toFixed(4)})`)
    }
  } else {
    console.log()
    console.log(`No strongly shared concepts found above threshold ${threshold}.`)
  }
}
