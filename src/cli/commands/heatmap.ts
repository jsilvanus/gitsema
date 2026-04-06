import { writeFileSync } from 'node:fs'
import { getActiveSession } from '../../core/db/sqlite.js'

export interface HeatmapOptions {
  period?: string // 'week' or 'month'
  dump?: string | boolean
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

    if (options.dump !== undefined) {
      const json = JSON.stringify(out, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Wrote heatmap JSON to ${options.dump}`)
      } else {
        console.log(json)
      }
      return
    }

    // Human-friendly output
    for (const k of Object.keys(out)) {
      console.log(`${k}: ${out[k]}`)
    }
  } catch (err) {
    console.error(`Error computing heatmap: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
