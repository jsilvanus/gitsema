import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { computeHealthTimeline } from '../../core/search/healthTimeline.js'
import { parsePositiveInt } from '../../utils/parse.js'
import { narrateHealthTimeline } from '../../core/llm/narrator.js'

export function healthCommand(): Command {
  return new Command('health')
    .description('Show codebase health timeline')
    .option('--buckets <n>', 'number of buckets', '12')
    .option('--branch <name>', 'branch name')
    .option('--narrate', 'generate an LLM narrative summary of health trends (requires GITSEMA_LLM_URL)')
    .option('--no-headings', "don't print column header row")
    .action(async (opts: { buckets?: string; branch?: string; narrate?: boolean; noHeadings?: boolean }) => {
      let buckets: number
      try {
        buckets = parsePositiveInt(opts.buckets ?? '12', '--buckets')
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
      const session = getActiveSession()
      const snaps = computeHealthTimeline(session, { buckets, branch: opts.branch })
      if (!opts.noHeadings) {
        console.log(`${'Period_Start'.padEnd(24)}  ${'Period_End'.padEnd(24)}  ${'Active'.padEnd(6)}  ${'Churn'.padEnd(6)}  Dead`)
      }
      for (const s of snaps) {
        console.log(`${new Date(s.periodStart * 1000).toISOString()} - ${new Date(s.periodEnd * 1000).toISOString()} active=${s.activeBlobCount} churn=${s.semanticChurnRate.toFixed(3)} dead=${s.deadConceptRatio.toFixed(3)}`)
      }

      if (opts.narrate && snaps.length > 0) {
        console.log('')
        console.log('=== LLM Health Narrative ===')
        const narrative = await narrateHealthTimeline(snaps)
        console.log(narrative)
      }
    })
}
