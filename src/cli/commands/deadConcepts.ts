import { writeFileSync } from 'node:fs'
import {
  findDeadConcepts,
  type DeadConceptResult,
} from '../../core/search/deadConcepts.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { shortHash } from '../../core/search/ranking.js'

export interface DeadConceptsCommandOptions {
  /** Number of results to return (default 10). */
  top?: string
  /**
   * Only consider dead blobs whose latest commit is on or after this date.
   * Accepts YYYY-MM-DD or ISO 8601.
   */
  since?: string
  /**
   * When present, write JSON output.  A string value is the output file path;
   * boolean `true` means print JSON to stdout.
   */
  dump?: string | boolean
  /** When set, restrict dead-concept candidates to blobs seen on this branch. */
  branch?: string
}

function formatDate(timestamp: number | null): string {
  if (timestamp === null) return '(unknown)'
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

/**
 * Renders dead-concept results as human-readable CLI output.
 */
function renderResults(results: DeadConceptResult[]): string {
  if (results.length === 0) {
    return 'No dead concepts found. All indexed blobs are present in HEAD, or the index is empty.'
  }

  const lines: string[] = [
    `Dead concepts — ${results.length} result${results.length === 1 ? '' : 's'}`,
    '',
  ]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const rank = String(i + 1).padStart(2)
    const score = r.score.toFixed(3)
    const pathStr = r.paths[0] ?? '(unknown path)'
    const extra = r.paths.length > 1 ? ` +${r.paths.length - 1} more` : ''
    lines.push(`${rank}. ${score}  ${pathStr}${extra}`)
    lines.push(`    blob:      ${shortHash(r.blobHash)}`)
    if (r.lastSeenCommit) {
      lines.push(`    last seen: ${shortHash(r.lastSeenCommit)}  (${formatDate(r.lastSeenDate)})`)
    }
    if (r.lastSeenMessage) {
      const msg =
        r.lastSeenMessage.length > 72
          ? r.lastSeenMessage.slice(0, 69) + '...'
          : r.lastSeenMessage
      lines.push(`    message:   ${msg}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export async function deadConceptsCommand(
  options: DeadConceptsCommandOptions,
): Promise<void> {
  const topK = options.top !== undefined ? parseInt(options.top, 10) : 10
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  let since: number | undefined
  if (options.since) {
    try {
      since = parseDateArg(options.since)
    } catch (err) {
      console.error(`Error: --since ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  let results: DeadConceptResult[] = []
  try {
    results = await findDeadConcepts({ topK, since, repoPath: '.', branch: options.branch })
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (options.dump !== undefined) {
    const json = JSON.stringify(results, null, 2)
    if (typeof options.dump === 'string') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`Wrote dead concepts JSON to ${options.dump}`)
    } else {
      console.log(json)
    }
    return
  }

  console.log(renderResults(results))
}
