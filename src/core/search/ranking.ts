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
 * Renders a list of SearchResults as human-readable CLI output.
 *
 * Example:
 *   0.921  src/auth/oauth.ts          [a3f9c2d]
 *   0.887  src/auth/session.ts        [b19e4a1]
 */
export function renderResults(results: SearchResult[]): string {
  if (results.length === 0) return '  (no results)'

  const lines: string[] = []
  for (const result of results) {
    const score = formatScore(result.score)
    const hash = shortHash(result.blobHash)
    if (result.paths.length === 0) {
      lines.push(`${score}  (unknown path)  [${hash}]`)
    } else {
      // Show primary path; list extras as additional lines
      lines.push(`${score}  ${result.paths[0].padEnd(40)}  [${hash}]`)
      for (let i = 1; i < result.paths.length; i++) {
        lines.push(`       ${result.paths[i].padEnd(40)}`)
      }
    }
  }
  return lines.join('\n')
}
