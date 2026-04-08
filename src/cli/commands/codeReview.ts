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
import { execSync } from 'node:child_process'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'

export interface CodeReviewOptions {
  base?: string
  head?: string
  diffFile?: string
  top?: string
  threshold?: string
  format?: string
}

interface HunkSummary {
  file: string
  addedLines: string[]
  removedLines: string[]
}

function parseDiff(diffText: string): HunkSummary[] {
  const hunks: HunkSummary[] = []
  let current: HunkSummary | null = null

  for (const line of diffText.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
    if (line.startsWith('diff --git ')) {
      // Extract file path
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

export async function codeReviewCommand(opts: CodeReviewOptions): Promise<void> {
  const topK = parseInt(opts.top ?? '5', 10)
  const threshold = parseFloat(opts.threshold ?? '0.75')
  const format = opts.format ?? 'text'

  // Obtain the diff text
  let diffText = ''
  if (opts.diffFile) {
    try {
      diffText = fs.readFileSync(opts.diffFile, 'utf8')
    } catch (err) {
      console.error(`Cannot read diff file: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  } else if (opts.base || opts.head) {
    const base = opts.base ?? 'main'
    const head = opts.head ?? 'HEAD'
    try {
      diffText = execSync(`git diff ${base}...${head}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    } catch (err) {
      console.error(`git diff failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  } else if (!process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    diffText = Buffer.concat(chunks).toString('utf8')
  } else {
    console.error('Error: provide --base/--head, --diff-file, or pipe a diff to stdin.')
    process.exit(1)
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

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const modelName = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProvider(providerType, modelName)

  const reviews: Array<{
    file: string
    analogues: Array<{ path: string; score: number }>
    regressionRisk: 'low' | 'medium' | 'high'
  }> = []

  for (const hunk of hunks) {
    if (hunk.addedLines.length === 0 && hunk.removedLines.length === 0) continue

    // Embed the added code as the "new concept"
    const addedText = hunk.addedLines.join('\n').slice(0, 2000)
    if (!addedText.trim()) continue

    let embedding: number[]
    try {
      embedding = await embedQuery(provider, addedText) as number[]
    } catch {
      continue
    }

    const results = vectorSearch(embedding, { topK, searchChunks: true })
    const analogues = results
      .filter((r) => r.score >= threshold)
      .map((r) => ({ path: r.paths?.[0] ?? r.blobHash.slice(0, 12), score: r.score }))

    // Simple regression risk heuristic: are removed lines similar to historical top results?
    let regressionRisk: 'low' | 'medium' | 'high' = 'low'
    if (hunk.removedLines.length > 0 && analogues.length > 0) {
      const removedText = hunk.removedLines.join('\n').slice(0, 2000)
      try {
        const removedEmbedding = await embedQuery(provider, removedText) as number[]
        const removedResults = vectorSearch(removedEmbedding, { topK: 3 })
        const maxRemovedScore = removedResults[0]?.score ?? 0
        if (maxRemovedScore >= 0.9) regressionRisk = 'high'
        else if (maxRemovedScore >= 0.75) regressionRisk = 'medium'
      } catch { /* ignore */ }
    }

    reviews.push({ file: hunk.file, analogues, regressionRisk })
  }

  if (format === 'json') {
    console.log(JSON.stringify({ reviews }, null, 2))
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
    console.log()
  }
}
