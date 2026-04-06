import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { scoreDebt } from '../../core/search/debtScoring.js'

export function debtCommand(): Command {
  return new Command('debt')
    .description('Score technical debt across the codebase')
    .option('--top <n>', 'top results', '20')
    .option('--model <model>', 'embedding model')
    .action((opts: { top?: string; model?: string }) => {
      const session = getActiveSession()
      const top = parseInt(opts.top ?? '20', 10)
      const results = scoreDebt(session, { model: opts.model }, { top, model: opts.model } as any)
      for (const r of results) console.log(`${r.blobHash}\t${r.debtScore.toFixed(3)}\t${r.paths.join(',')}`)
    })
}
