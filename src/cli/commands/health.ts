import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { computeHealthTimeline } from '../../core/search/healthTimeline.js'
import { parsePositiveInt } from '../../utils/parse.js'

export function healthCommand(): Command {
  return new Command('health')
    .description('Show codebase health timeline')
    .option('--buckets <n>', 'number of buckets', '12')
    .option('--branch <name>', 'branch name')
    .action((opts: { buckets?: string; branch?: string }) => {
      let buckets: number
      try {
        buckets = parsePositiveInt(opts.buckets ?? '12', '--buckets')
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
      const session = getActiveSession()
      const snaps = computeHealthTimeline(session, { buckets, branch: opts.branch })
      for (const s of snaps) console.log(`${new Date(s.periodStart*1000).toISOString()} - ${new Date(s.periodEnd*1000).toISOString()} active=${s.activeBlobCount} churn=${s.semanticChurnRate.toFixed(3)} dead=${s.deadConceptRatio.toFixed(3)}`)
    })
}
