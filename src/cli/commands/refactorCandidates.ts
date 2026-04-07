import { writeFileSync } from 'node:fs'
import { computeRefactorCandidates, type RefactorReport, type RefactorPair } from '../../core/search/refactorCandidates.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface RefactorCandidatesCommandOptions {
  threshold?: string
  top?: string
  level?: string
  dump?: string | boolean
  noHeadings?: boolean
  out?: string[]
}

function renderReport(report: RefactorReport, showHeadings = true): string {
  const lines: string[] = []
  if (showHeadings) {
    lines.push(`Refactoring candidates (level=${report.level}, threshold=${report.threshold}, scanned=${report.totalScanned})`)
    lines.push('')
  }
  if (report.pairs.length === 0) {
    lines.push('  No candidates found above threshold.')
    return lines.join('\n')
  }
  for (let i = 0; i < report.pairs.length; i++) {
    const p = report.pairs[i]
    const aLabel = p.nameA ? `${p.pathA}::${p.nameA}` : p.pathA
    const bLabel = p.nameB ? `${p.pathB}::${p.nameB}` : p.pathB
    lines.push(`${String(i + 1).padStart(3)}. ${p.similarity.toFixed(3)}  ${aLabel}`)
    lines.push(`       ↔  ${bLabel}`)
    lines.push('')
  }
  return lines.join('\n')
}

export async function refactorCandidatesCommand(options: RefactorCandidatesCommandOptions): Promise<void> {
  const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.88
  const topK = options.top !== undefined ? parseInt(options.top, 10) : 50
  const level = (options.level ?? 'symbol') as 'symbol' | 'chunk' | 'file'

  let report: RefactorReport
  try {
    report = computeRefactorCandidates({ threshold, topK, level })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    process.exit(1)
    throw err
  }

  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: undefined })
  const jsonSink = getSink(sinks, 'json')

  if (jsonSink) {
    const json = JSON.stringify(report, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Refactor candidates written to: ${jsonSink.file}`)
    } else {
      process.stdout.write(json + '\n')
      return
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  console.log(renderReport(report, !options.noHeadings))
}
