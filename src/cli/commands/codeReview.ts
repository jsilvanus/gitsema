/**
 * `gitsema code-review` — semantic code review assistant (Phase 81).
 *
 * Given a diff (from stdin, --diff-file, or by comparing two git refs),
 * finds historical analogues for the changed code and flags potential regressions
 * by comparing semantic similarity to previously seen patterns.
 *
 * Usage:
 *   git diff main...HEAD | gitsema code-review
 *   gitsema code-review --base main --head HEAD
 *   gitsema code-review --diff-file my.patch
 *
 * Output:
 *   - Top historical analogues per changed file
 *   - Regression risk score if similar code existed and was removed/changed
 */

import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { buildProviderOrExit, resolveModels } from '../lib/provider.js'
import { EXIT_USAGE, EXIT_RUNTIME } from '../lib/errors.js'
import { resolveOutputs, getSink } from '../../utils/outputSink.js'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { formatStructuralContext } from '../../core/graph/structuralContext.js'
import { parseLens } from '../lib/lens.js'
import { isSafeGitRange } from '../../core/narrator/narrator.js'
import { parseDiff, computeCodeReview, type CodeReviewEntry } from '../../core/search/codeReview.js'

export interface CodeReviewOptions {
  base?: string
  head?: string
  diffFile?: string
  top?: string
  threshold?: string
  format?: string
  /** Unified output spec (repeatable); --out wins over --format */
  out?: string[]
  /** Phase 111 lens toggle. Default `semantic` keeps output byte-identical. */
  lens?: string
}

export async function codeReviewCommand(opts: CodeReviewOptions): Promise<void> {
  const topK = parseInt(opts.top ?? '5', 10)
  const threshold = parseFloat(opts.threshold ?? '0.75')

  // --out wins over --format when present; otherwise --format keeps working unchanged.
  const sinks = opts.out && opts.out.length > 0
    ? resolveOutputs({ out: opts.out })
    : undefined
  const jsonSink = sinks ? getSink(sinks, 'json') : undefined
  const format = sinks ? (jsonSink ? 'json' : 'text') : (opts.format ?? 'text')

  // Obtain the diff text
  let diffText = ''
  if (opts.diffFile) {
    try {
      diffText = fs.readFileSync(opts.diffFile, 'utf8')
    } catch (err) {
      console.error(`Cannot read diff file: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(EXIT_USAGE)
    }
  } else if (opts.base || opts.head) {
    const base = opts.base ?? 'main'
    const head = opts.head ?? 'HEAD'
    // Spawned via execFileSync (no shell) and gated through isSafeGitRange (same
    // pattern as narrator.ts), since base/head are otherwise externally controllable
    // and could be crafted to look like a git option (e.g. a leading `-`).
    if (!isSafeGitRange(base) || !isSafeGitRange(head)) {
      console.error(`Invalid --base/--head value: "${base}" / "${head}"`)
      process.exit(EXIT_USAGE)
    }
    try {
      diffText = execFileSync('git', ['diff', `${base}...${head}`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    } catch (err) {
      console.error(`git diff failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(EXIT_USAGE)
    }
  } else if (!process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    diffText = Buffer.concat(chunks).toString('utf8')
  } else {
    console.error('Error: provide --base/--head, --diff-file, or pipe a diff to stdin.')
    process.exit(EXIT_USAGE)
  }

  if (!diffText.trim()) {
    console.log('No diff content to review.')
    return
  }

  const hunks = parseDiff(diffText)
  if (hunks.length === 0) {
    console.log('No changed files detected in diff.')
    return
  }

  const { providerType, textModel: modelName } = resolveModels({})
  const provider = buildProviderOrExit(providerType, modelName, EXIT_RUNTIME)

  const lens = parseLens(opts.lens, 'semantic')
  const graph = lens !== 'semantic' ? getCachedStorageProfile(process.cwd()).graph : undefined

  const reviews: CodeReviewEntry[] = await computeCodeReview(hunks, provider, { topK, threshold, graph })

  if (format === 'json') {
    const json = JSON.stringify({ reviews }, null, 2)
    if (jsonSink?.file) {
      fs.writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Code review JSON written to: ${jsonSink.file}`)
    } else {
      console.log(json)
    }
    return
  }

  console.log(`Semantic code review (model: ${modelName})`)
  console.log(`Files reviewed: ${hunks.length}  |  Threshold: ${threshold}`)
  console.log()

  if (reviews.length === 0) {
    console.log('No changed files with added code to review.')
    return
  }

  for (const r of reviews) {
    const riskIcon = r.regressionRisk === 'high' ? '🔴' : r.regressionRisk === 'medium' ? '🟡' : '🟢'
    console.log(`${riskIcon} ${r.file}  (regression risk: ${r.regressionRisk})`)
    if (r.analogues.length > 0) {
      console.log('  Historical analogues:')
      for (const a of r.analogues) {
        console.log(`    ${a.score.toFixed(4)}  ${a.path}`)
      }
    } else {
      console.log('  No historical analogues found above threshold.')
    }
    if (r.structural?.found) {
      const summary = formatStructuralContext(r.structural)
      if (summary) console.log(`  Structural [structural]: ${summary}`)
    }
    console.log()
  }
}
