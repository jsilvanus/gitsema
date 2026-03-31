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
 * Renders a list of SearchResults as human-readable CLI output.
 * Shows the firstSeen date alongside each result when available.
 *
 * Example:
 *   0.921  src/auth/oauth.ts                          [a3f9c2d]  first: 2022-03-15
 *   0.887  src/auth/session.ts                        [b19e4a1]
 */
export function renderResults(results: SearchResult[]): string {
  if (results.length === 0) return '  (no results)'

  const lines: string[] = []
  for (const result of results) {
    const score = formatScore(result.score)
    const hash = shortHash(result.blobHash)
    const dateSuffix = result.firstSeen !== undefined ? `  first: ${formatDate(result.firstSeen)}` : ''
    if (result.paths.length === 0) {
      lines.push(`${score}  (unknown path)  [${hash}]${dateSuffix}`)
    } else {
      lines.push(`${score}  ${result.paths[0].padEnd(40)}  [${hash}]${dateSuffix}`)
      for (let i = 1; i < result.paths.length; i++) {
        lines.push(`       ${result.paths[i].padEnd(40)}`)
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
export function renderFirstSeenResults(results: SearchResult[]): string {
  if (results.length === 0) return '  (no results)'

  // Sort by firstSeen ascending (earliest first); blobs without history go last
  const sorted = [...results].sort((a, b) => {
    if (a.firstSeen === undefined && b.firstSeen === undefined) return 0
    if (a.firstSeen === undefined) return 1
    if (b.firstSeen === undefined) return -1
    return a.firstSeen - b.firstSeen
  })

  const lines: string[] = []
  for (const result of sorted) {
    const hash = shortHash(result.blobHash)
    const score = formatScore(result.score)
    const date = result.firstSeen !== undefined ? formatDate(result.firstSeen) : '(unknown)'
    if (result.paths.length === 0) {
      lines.push(`${date}  (unknown path)  [${hash}]  (score: ${score})`)
    } else {
      lines.push(`${date}  ${result.paths[0].padEnd(40)}  [${hash}]  (score: ${score})`)
      for (let i = 1; i < result.paths.length; i++) {
        lines.push(`          ${result.paths[i].padEnd(40)}`)
      }
    }
  }
  return lines.join('\n')
}

