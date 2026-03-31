import { computeEvolution } from '../../core/search/evolution.js'
import { formatDate, shortHash } from '../../core/search/ranking.js'

export interface EvolutionCommandOptions {
  threshold?: string
}

/**
 * Renders the semantic evolution timeline for a file as human-readable CLI output.
 *
 * Example:
 *   2021-03-15  a3f9c2d  dist_prev=0.000  dist_origin=0.000  (origin)
 *   2022-06-10  b19e4a1  dist_prev=0.123  dist_origin=0.123
 *   2023-01-05  c02d8f7  dist_prev=0.412  dist_origin=0.389  ← large change
 */
function renderEvolution(
  entries: ReturnType<typeof computeEvolution>,
  threshold: number,
): string {
  if (entries.length === 0) return '  (no history found — has the file been indexed?)'

  const lines: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const date = formatDate(e.timestamp)
    const hash = shortHash(e.blobHash)
    const commitShort = shortHash(e.commitHash)
    const dPrev = e.distFromPrev.toFixed(4)
    const dOrigin = e.distFromOrigin.toFixed(4)
    let note = ''
    if (i === 0) note = '  (origin)'
    else if (e.distFromPrev >= threshold) note = '  ← large change'
    lines.push(
      `${date}  blob:${hash}  commit:${commitShort}  dist_prev=${dPrev}  dist_origin=${dOrigin}${note}`,
    )
  }
  return lines.join('\n')
}

export async function evolutionCommand(
  filePath: string,
  options: EvolutionCommandOptions,
): Promise<void> {
  if (!filePath || filePath.trim() === '') {
    console.error('Error: file path is required')
    process.exit(1)
  }

  const threshold =
    options.threshold !== undefined ? parseFloat(options.threshold) : 0.3
  if (isNaN(threshold) || threshold < 0 || threshold > 2) {
    console.error('Error: --threshold must be a number between 0 and 2')
    process.exit(1)
  }

  const entries = computeEvolution(filePath.trim())
  console.log(`Evolution of: ${filePath}`)
  console.log(`Versions found: ${entries.length}`)
  if (entries.length > 0) {
    console.log('')
    console.log(renderEvolution(entries, threshold))
  }
}
