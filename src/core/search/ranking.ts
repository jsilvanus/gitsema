import type { SearchResult } from '../models/types.js'

/**
 * Formats a blob hash to a short 7-char representation (like git log --abbrev).
 */
export function shortHash(hash: string): string {
  return hash.slice(0, 7)
}

/**
 * Formats a cosine similarity score as a 0.000 decimal string.
 */
export function formatScore(score: number): string {
  return score.toFixed(3)
}

/**
 * Formats a Unix timestamp (seconds) as a YYYY-MM-DD string.
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

/**
 * Grouping modes for `groupResults()`.
 * - `file`   — collapse results that share the same file path (top chunk wins)
 * - `module` — collapse results in the same directory
 * - `commit` — collapse results that share the same earliest commit
 */
export type GroupMode = 'file' | 'module' | 'commit'

/**
 * Groups a ranked list of SearchResults using the given mode.
 * Within each group the highest-scoring result is kept as the representative.
 * The output list is sorted by the representative's score (descending) and
 * truncated to topK.
 */
export function groupResults(results: SearchResult[], mode: GroupMode, topK: number): SearchResult[] {
  const grouped = new Map<string, SearchResult>()

  for (const result of results) {
    let key: string

    switch (mode) {
      case 'file': {
        // Group by first known path (or blobHash if no path)
        key = result.paths[0] ?? result.blobHash
        break
      }
      case 'module': {
        // Group by directory of the first known path
        const p = result.paths[0] ?? result.blobHash
        const slash = p.lastIndexOf('/')
        key = slash >= 0 ? p.slice(0, slash) : '.'
        break
      }
      case 'commit': {
        key = result.firstCommit ?? result.blobHash
        break
      }
    }

    const existing = grouped.get(key)
    if (!existing || result.score > existing.score) {
      grouped.set(key, result)
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * Renders a list of SearchResults as human-readable CLI output.
 * Shows the firstSeen date alongside each result when available.
 * When a result is a chunk, the line range is shown in the path column.
 *
 * Example:
 *   0.921  src/auth/oauth.ts:10-45                    [a3f9c2d]  first: 2022-03-15
 *   0.887  src/auth/session.ts                        [b19e4a1]
 */
export function renderResults(results: SearchResult[]): string {
  if (results.length === 0) return '  (no results)'

  const lines: string[] = []
  for (const result of results) {
    const score = formatScore(result.score)
    const hash = shortHash(result.blobHash)
    const dateSuffix = result.firstSeen !== undefined
      ? `  first: ${formatDate(result.firstSeen)}${result.firstCommit ? ` [${shortHash(result.firstCommit)}]` : ''}`
      : ''
    const lineSuffix = result.startLine !== undefined && result.endLine !== undefined
      ? `:${result.startLine}-${result.endLine}`
      : ''
    const clusterSuffix = result.clusterLabel ? `  [cluster: ${result.clusterLabel}]` : ''
    const signalSuffix = result.signals
      ? `  [cos=${result.signals.cosine.toFixed(3)}${result.signals.recency !== undefined ? ` rec=${result.signals.recency.toFixed(3)}` : ''}${result.signals.pathScore !== undefined ? ` path=${result.signals.pathScore.toFixed(3)}` : ''}${result.signals.bm25 !== undefined ? ` bm25=${result.signals.bm25.toFixed(3)}` : ''}]`
      : ''
    if (result.paths.length === 0) {
      lines.push(`${score}  (unknown path)  [${hash}]${dateSuffix}${clusterSuffix}${signalSuffix}`)
    } else {
      const pathStr = result.paths[0] + lineSuffix
      lines.push(`${score}  ${pathStr.padEnd(50)}  [${hash}]${dateSuffix}${clusterSuffix}${signalSuffix}`)
      for (let i = 1; i < result.paths.length; i++) {
        lines.push(`       ${result.paths[i].padEnd(50)}`)
      }
    }
  }
  return lines.join('\n')
}

/**
 * Renders first-seen results sorted by date (earliest first).
 * The primary sort key is the firstSeen timestamp; score is shown for reference.
 *
 * Example:
 *   2021-03-15  src/auth/oauth.ts          [a3f9c2d]  (score: 0.921)
 *   2021-08-22  src/auth/session.ts        [b19e4a1]  (score: 0.887)
 */
export function renderFirstSeenResults(results: SearchResult[], showHeadings = true): string {
  if (results.length === 0) return '  (no results)'

  // Sort by firstSeen ascending (earliest first); blobs without history go last
  const sorted = [...results].sort((a, b) => {
    if (a.firstSeen === undefined && b.firstSeen === undefined) return 0
    if (a.firstSeen === undefined) return 1
    if (b.firstSeen === undefined) return -1
    return a.firstSeen - b.firstSeen
  })

  const lines: string[] = []

  // Header row for clarity: Date | Commit | Path | Blob | Score
  const headerDate = 'Date'
  const headerCommit = 'Commit'
  const headerPath = 'Path'
  const headerHash = 'Blob'
  const headerScore = 'Score'
  const pathColWidth = 50
  const dateColWidth = 10
  const commitColWidth = 8
  if (showHeadings) {
    const headerLine = `${headerDate.padEnd(dateColWidth)}  ${headerCommit.padEnd(commitColWidth)}  ${headerPath.padEnd(pathColWidth)}  ${headerHash.padEnd(8)}  ${headerScore}`
    lines.push(headerLine)
  }
  for (const result of sorted) {
    const hash = shortHash(result.blobHash)
    const score = formatScore(result.score)
    const date = result.firstSeen !== undefined ? formatDate(result.firstSeen) : '(unknown)'
    const commit = result.firstCommit ? shortHash(result.firstCommit) : ''
    if (result.paths.length === 0) {
      const pathStr = '(unknown path)'
      lines.push(`${date.padEnd(dateColWidth)}  ${commit.padEnd(commitColWidth)}  ${pathStr.padEnd(pathColWidth)}  [${hash}]  ${`(${score})`}`)
    } else {
      lines.push(`${date.padEnd(dateColWidth)}  ${commit.padEnd(commitColWidth)}  ${result.paths[0].padEnd(pathColWidth)}  [${hash}]  ${`(${score})`}`)
      for (let i = 1; i < result.paths.length; i++) {
        lines.push(`          ${result.paths[i].padEnd(pathColWidth)}`)
      }
    }
  }
  return lines.join('\n')
}

