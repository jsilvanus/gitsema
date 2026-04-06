import { writeFileSync } from 'node:fs'
import { computeDocGap, type DocGapResult } from '../../core/search/docGap.js'
import { shortHash, formatScore } from '../../core/search/ranking.js'

export interface DocGapCommandOptions {
  top?: string
  threshold?: string
  branch?: string
  dump?: string | boolean
}

function renderResults(results: DocGapResult[]): string {
  if (results.length === 0) return 'No undocumented code found or index is empty.'
  const lines: string[] = []
  lines.push(`Documentation gap — ${results.length} result${results.length === 1 ? '' : 's'}`)
  lines.push('')
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const rank = String(i + 1).padStart(2)
    const score = formatScore(r.maxDocSimilarity)
    const pathStr = r.paths[0] ?? '(unknown path)'
    const extra = r.paths.length > 1 ? ` +${r.paths.length - 1} more` : ''
    lines.push(`${rank}. ${score}  ${pathStr}${extra}`)
    lines.push(`    blob: ${shortHash(r.blobHash)}`)
    lines.push('')
  }
  return lines.join('\n')
}

export async function docGapCommand(options: DocGapCommandOptions): Promise<void> {
  const topK = options.top !== undefined ? parseInt(options.top, 10) : 20
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  let threshold: number | undefined
  if (options.threshold !== undefined) {
    threshold = parseFloat(options.threshold)
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      console.error('Error: --threshold must be a number between 0 and 1')
      process.exit(1)
    }
  }

  let results: DocGapResult[] = []
  try {
    results = await computeDocGap({ topK, threshold, branch: options.branch })
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (options.dump !== undefined) {
    const json = JSON.stringify(results, null, 2)
    if (typeof options.dump === 'string') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`Wrote doc-gap JSON to ${options.dump}`)
    } else {
      console.log(json)
    }
    return
  }

  console.log(renderResults(results))
}
