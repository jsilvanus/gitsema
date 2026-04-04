import { writeFileSync } from 'node:fs'
import {
  computeFileChangePoints,
  type FileChangePointReport,
  type FileChangePoint,
} from '../../core/search/changePoints.js'
import { resolveRefToTimestamp } from '../../core/search/clustering.js'
import { renderFileChangePointsHtml } from '../../core/viz/htmlRenderer.js'

export interface FileChangePointsCommandOptions {
  threshold?: string
  topPoints?: string
  since?: string
  until?: string
  dump?: string | boolean
  html?: string | boolean
  includeContent?: boolean
}

function renderFileChangePoint(point: FileChangePoint, rank: number): string {
  const lines: string[] = []
  lines.push(
    `  #${rank}  ${point.before.date} → ${point.after.date}  distance=${point.distance.toFixed(4)}`,
  )
  lines.push(
    `       before: [${point.before.commit.slice(0, 7)}]  blob=${point.before.blobHash.slice(0, 7)}`,
  )
  lines.push(
    `       after:  [${point.after.commit.slice(0, 7)}]  blob=${point.after.blobHash.slice(0, 7)}`,
  )
  return lines.join('\n')
}

function renderReport(path: string, report: FileChangePointReport): string {
  const lines: string[] = []

  if (report.range.since || report.range.until) {
    const sinceStr = report.range.since ?? '(earliest)'
    const untilStr = report.range.until ?? '(latest)'
    lines.push(`Range: ${sinceStr} → ${untilStr}`)
  }
  lines.push(`threshold=${report.threshold}`)
  lines.push('')

  if (report.points.length === 0) {
    lines.push(`  (no change points found above threshold ${report.threshold})`)
    return lines.join('\n')
  }

  lines.push(`Top ${report.points.length} change point(s) for ${path}:`)
  lines.push('')
  for (let i = 0; i < report.points.length; i++) {
    lines.push(renderFileChangePoint(report.points[i], i + 1))
    lines.push('')
  }
  return lines.join('\n')
}

export async function fileChangePointsCommand(
  filePath: string,
  options: FileChangePointsCommandOptions,
): Promise<void> {
  if (!filePath || filePath.trim() === '') {
    console.error('Error: file path is required')
    process.exit(1)
  }

  const threshold = options.threshold !== undefined ? parseFloat(options.threshold) : 0.3
  if (isNaN(threshold) || threshold < 0 || threshold > 2) {
    console.error('Error: --threshold must be a number between 0 and 2')
    process.exit(1)
  }

  const topPoints = options.topPoints !== undefined ? parseInt(options.topPoints, 10) : 5
  if (isNaN(topPoints) || topPoints < 1) {
    console.error('Error: --top-points must be a positive integer')
    process.exit(1)
  }

  let since: number | undefined
  let until: number | undefined

  if (options.since !== undefined) {
    try {
      since = resolveRefToTimestamp(options.since)
    } catch {
      console.error(`Error: cannot resolve --since "${options.since}" to a timestamp.`)
      process.exit(1)
    }
  }
  if (options.until !== undefined) {
    try {
      until = resolveRefToTimestamp(options.until)
    } catch {
      console.error(`Error: cannot resolve --until "${options.until}" to a timestamp.`)
      process.exit(1)
    }
  }

  try {
    const report = computeFileChangePoints(filePath.trim(), { threshold, topPoints, since, until })

    if (options.dump !== undefined) {
      const json = JSON.stringify(report, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`File change points JSON written to: ${options.dump}`)
      } else {
        process.stdout.write(json + '\n')
        return
      }
    }

    if (options.html !== undefined) {
      const html = renderFileChangePointsHtml(report)
      const outFile = typeof options.html === 'string' ? options.html : 'file-change-points.html'
      writeFileSync(outFile, html, 'utf8')
      console.log(`File change points HTML written to: ${outFile}`)
      return
    }

    console.log(`File change points: "${filePath}"`)
    console.log(renderReport(filePath.trim(), report))
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
