import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import type { Embedding } from '../../core/models/types.js'
import { computeSemanticDiff, type SemanticDiffResult } from '../../core/search/semanticDiff.js'
import { renderSemanticDiffHtml } from '../../core/viz/htmlRenderer.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { formatDate, shortHash } from '../../core/search/ranking.js'

export interface CiDiffCommandOptions {
  base?: string
  head?: string
  query?: string
  top?: string
  format?: string
  threshold?: string
  out?: string
  model?: string
  textModel?: string
  codeModel?: string
  /** GitHub token for posting PR review comments (overrides GITHUB_TOKEN env var) */
  githubToken?: string
}

function buildProviderOrExit(providerType: string, model: string): EmbeddingProvider {
  try {
    return buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
  }
}

function renderSummaryText(result: SemanticDiffResult, threshold: number): string {
  const lines: string[] = []
  lines.push(`CI Semantic Diff: ${result.ref1} → ${result.ref2}`)
  lines.push(`Query: "${result.topic}"`)
  lines.push('')
  lines.push(`Gained:  ${result.gained.length} concept(s)`)
  lines.push(`Lost:    ${result.lost.length} concept(s)`)
  lines.push(`Stable:  ${result.stable.length} concept(s)`)
  if (result.gained.length > 0) {
    lines.push('')
    lines.push('Gained:')
    for (const e of result.gained) {
      lines.push(`  ${e.score.toFixed(3)}  ${e.paths[0] ?? e.blobHash.slice(0, 7)}`)
    }
  }
  if (result.lost.length > 0) {
    lines.push('')
    lines.push('Lost:')
    for (const e of result.lost) {
      lines.push(`  ${e.score.toFixed(3)}  ${e.paths[0] ?? e.blobHash.slice(0, 7)}`)
    }
  }
  return lines.join('\n')
}

export async function ciDiffCommand(options: CiDiffCommandOptions): Promise<void> {
  const base = options.base ?? 'HEAD~1'
  const head = options.head ?? 'HEAD'
  const query = options.query ?? 'semantic changes'
  const topK = options.top !== undefined ? parseInt(options.top, 10) : 20
  const format = options.format ?? 'text'
  const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.3

  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProviderOrExit(providerType, model)

  let queryEmbedding: Embedding
  try {
    queryEmbedding = await embedQuery(provider, query)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not embed query — ${msg}`)
    process.exit(1)
    throw err
  }

  let result: SemanticDiffResult
  try {
    result = computeSemanticDiff(queryEmbedding, query, base, head, topK)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    process.exit(1)
    throw err
  }

  if (format === 'html') {
    const html = renderSemanticDiffHtml(result)
    const outFile = options.out ?? 'ci-diff.html'
    writeFileSync(outFile, html, 'utf8')
    console.log(`CI diff HTML written to: ${outFile}`)
    return
  }

  if (format === 'json') {
    const json = JSON.stringify(result, null, 2)
    if (options.out) {
      writeFileSync(options.out, json, 'utf8')
      console.log(`CI diff JSON written to: ${options.out}`)
    } else {
      process.stdout.write(json + '\n')
    }
    return
  }

  // text format (default)
  const text = renderSummaryText(result, threshold)
  if (options.out) {
    writeFileSync(options.out, text, 'utf8')
    console.log(`CI diff written to: ${options.out}`)
  } else {
    console.log(text)
  }

  // Post as GitHub PR review comment if token is provided
  const githubToken = options.githubToken ?? process.env.GITHUB_TOKEN
  if (githubToken) {
    await postGithubPrComment(text, githubToken)
  }

  // Exit with non-zero if there are significant changes (for CI gate use case)
  if (result.gained.length > 0 || result.lost.length > 0) {
    process.exitCode = 1
  }
}

/**
 * Post a CI diff comment to the current GitHub PR via the GitHub REST API.
 * Reads PR number and repo from standard GitHub Actions environment variables.
 */
async function postGithubPrComment(body: string, token: string): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY // e.g. "owner/repo"
  const prNumber = process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)\//)?.[1]
    ?? process.env.GITHUB_PR_NUMBER

  if (!repo || !prNumber) {
    console.error(
      'Warning: --github-token was provided but GITHUB_REPOSITORY and GITHUB_REF (or GITHUB_PR_NUMBER) are not set. ' +
      'Cannot post PR comment. Set these in a GitHub Actions environment.',
    )
    return
  }

  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`
  const commentBody = `**gitsema CI semantic diff**\n\n\`\`\`\n${body}\n\`\`\``

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ body: commentBody }),
    })
    if (response.ok) {
      console.log(`GitHub PR comment posted to ${repo}#${prNumber}`)
    } else {
      const err = await response.text()
      console.error(`Warning: failed to post GitHub PR comment: ${response.status} ${err.slice(0, 100)}`)
    }
  } catch (e) {
    console.error(`Warning: failed to post GitHub PR comment: ${e instanceof Error ? e.message : String(e)}`)
  }
}
