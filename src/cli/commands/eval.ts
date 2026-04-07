/**
 * Retrieval evaluation harness (Phase 64).
 *
 * Reads a JSONL file of evaluation cases with shape:
 *   { "query": "...", "expectedPaths": ["src/foo.ts", "src/bar.ts"] }
 *
 * For each case, runs vector search and measures:
 *   - Precision@k (P@k): fraction of top-k results that are expected
 *   - Recall@k (R@k): fraction of expected paths found in top-k results
 *   - MRR: reciprocal rank of the first expected hit
 *   - Latency: search wall-clock time
 *
 * Outputs a summary table to stdout, and optionally writes full JSON results
 * to a file for CI dashboards.
 */

import { createReadStream } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { getTextProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface EvalCase {
  query: string
  expectedPaths: string[]
}

export interface EvalResult {
  query: string
  expectedPaths: string[]
  topPaths: string[]
  precisionAtK: number
  recallAtK: number
  mrr: number
  latencyMs: number
}

export interface EvalCommandOptions {
  file: string
  top?: string
  dump?: string | boolean
  out?: string[]
}

async function loadEvalCases(filePath: string): Promise<EvalCase[]> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
  const cases: EvalCase[] = []
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue
    try {
      const parsed = JSON.parse(trimmed) as EvalCase
      if (parsed.query && Array.isArray(parsed.expectedPaths)) {
        cases.push(parsed)
      }
    } catch {
      // Skip malformed lines
    }
  }
  return cases
}

function precision(topPaths: string[], expected: string[]): number {
  if (topPaths.length === 0) return 0
  const expectedSet = new Set(expected)
  const hits = topPaths.filter((p) => expectedSet.has(p)).length
  return hits / topPaths.length
}

function recall(topPaths: string[], expected: string[]): number {
  if (expected.length === 0) return 1
  const expectedSet = new Set(expected)
  const hits = topPaths.filter((p) => expectedSet.has(p)).length
  return hits / expected.length
}

function mrr(topPaths: string[], expected: string[]): number {
  const expectedSet = new Set(expected)
  for (let i = 0; i < topPaths.length; i++) {
    if (expectedSet.has(topPaths[i])) return 1 / (i + 1)
  }
  return 0
}

export async function evalCommand(options: EvalCommandOptions): Promise<void> {
  const topK = options.top ? parseInt(options.top, 10) : 10
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  const textProvider = getTextProvider()

  let cases: EvalCase[]
  try {
    cases = await loadEvalCases(options.file)
  } catch (err) {
    console.error(`Error reading eval file: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (cases.length === 0) {
    console.error('No evaluation cases found in the file.')
    process.exit(1)
  }

  console.log(`Evaluating ${cases.length} case(s) at top-${topK}…\n`)

  const results: EvalResult[] = []
  for (const c of cases) {
    const t0 = Date.now()
    let topPaths: string[] = []
    try {
      const embedding = await embedQuery(textProvider, c.query)
      const hits = vectorSearch(embedding, { topK })
      topPaths = hits.flatMap((h) => h.paths.slice(0, 1))
    } catch (err) {
      console.warn(`  Warning: search failed for "${c.query}": ${err instanceof Error ? err.message : String(err)}`)
    }
    const latencyMs = Date.now() - t0

    const result: EvalResult = {
      query: c.query,
      expectedPaths: c.expectedPaths,
      topPaths,
      precisionAtK: precision(topPaths, c.expectedPaths),
      recallAtK: recall(topPaths, c.expectedPaths),
      mrr: mrr(topPaths, c.expectedPaths),
      latencyMs,
    }
    results.push(result)
    console.log(`  Q: "${c.query.slice(0, 60)}"`)
    console.log(`    P@${topK}=${result.precisionAtK.toFixed(3)}  R@${topK}=${result.recallAtK.toFixed(3)}  MRR=${result.mrr.toFixed(3)}  (${latencyMs}ms)`)
  }

  // Aggregate metrics
  const avgP = results.reduce((s, r) => s + r.precisionAtK, 0) / results.length
  const avgR = results.reduce((s, r) => s + r.recallAtK, 0) / results.length
  const avgMRR = results.reduce((s, r) => s + r.mrr, 0) / results.length
  const avgLat = results.reduce((s, r) => s + r.latencyMs, 0) / results.length

  console.log(`\n── Summary (n=${results.length}, k=${topK}) ─────────────────────────────────`)
  console.log(`  Mean P@${topK}:   ${avgP.toFixed(4)}`)
  console.log(`  Mean R@${topK}:   ${avgR.toFixed(4)}`)
  console.log(`  Mean MRR:     ${avgMRR.toFixed(4)}`)
  console.log(`  Mean latency: ${avgLat.toFixed(1)}ms`)

  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: undefined })
  const jsonSink = getSink(sinks, 'json')

  if (jsonSink) {
    const json = JSON.stringify({ cases: results, summary: { avgPrecision: avgP, avgRecall: avgR, avgMRR, avgLatencyMs: avgLat, topK } }, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`\nEval results written to ${jsonSink.file}`)
    } else {
      console.log('\n' + json)
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }
}
