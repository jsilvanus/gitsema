import { writeFileSync } from 'node:fs'
import { getActiveSession } from '../../core/db/sqlite.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface HeatmapOptions {
  period?: string // 'week' or 'month'
  dump?: string | boolean
  noHeadings?: boolean
  out?: string[]
}

export async function heatmapCommand(options: HeatmapOptions): Promise<void> {
  const period = options.period === 'month' ? 'month' : 'week'
  const { rawDb } = getActiveSession()

  const fmt = period === 'month' ? `'%Y-%m'` : `'%Y-%W'`
  const sql = `SELECT strftime(${fmt}, datetime(c.timestamp, 'unixepoch')) AS period, COUNT(DISTINCT b.blob_hash) AS cnt
    FROM blob_commits b JOIN commits c ON b.commit_hash = c.commit_hash
    GROUP BY period ORDER BY period`

  try {
    const rows = rawDb.prepare(sql).all() as Array<{ period: string; cnt: number }>
    const out: Record<string, number> = {}
    for (const r of rows) out[r.period] = r.cnt

    const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: undefined })
    const jsonSink = getSink(sinks, 'json')

    if (jsonSink) {
      const json = JSON.stringify(out, null, 2)
      if (jsonSink.file) {
        writeFileSync(jsonSink.file, json, 'utf8')
        console.log(`Wrote heatmap JSON to ${jsonSink.file}`)
      } else {
        process.stdout.write(json + '\n')
        return
      }
      if (!hasSinkFormat(sinks, 'text')) return
    }

    // Human-friendly output
    if (!options.noHeadings) {
      console.log(`${'Period'.padEnd(10)}  Count`)
    }
    for (const k of Object.keys(out)) {
      console.log(`${k}: ${out[k]}`)
    }
  } catch (err) {
    console.error(`Error computing heatmap: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
