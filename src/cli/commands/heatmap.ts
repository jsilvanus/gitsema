import { getActiveSession } from '../../core/db/sqlite.js'

export interface HeatmapOptions {
  period?: string // 'week' or 'month'
  dump?: string | boolean
}

export async function heatmapCommand(options: HeatmapOptions): Promise<void> {
  const period = options.period === 'month' ? 'month' : 'week'
  const { rawDb } = getActiveSession()

  let sql
  if (period === 'week') {
    // Year-week
    sql = `SELECT strftime('%Y-%W', datetime(c.timestamp, 'unixepoch')) AS period, COUNT(DISTINCT b.blob_hash) AS cnt
      FROM blob_commits b JOIN commits c ON b.commit_hash = c.commit_hash
      GROUP BY period ORDER BY period`
  } else {
    // Year-month
    sql = `SELECT strftime('%Y-%m', datetime(c.timestamp, 'unixepoch')) AS period, COUNT(DISTINCT b.blob_hash) AS cnt
      FROM blob_commits b JOIN commits c ON b.commit_hash = c.commit_hash
      GROUP BY period ORDER BY period`
  }

  try {
    const rows = rawDb.prepare(sql).all() as Array<{ period: string; cnt: number }>
    const out: Record<string, number> = {}
    for (const r of rows) out[r.period] = r.cnt
    if (options.dump !== undefined) {
      if (typeof options.dump === 'string') console.log(JSON.stringify(out, null, 2))
      else console.log(JSON.stringify(out, null, 2))
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
