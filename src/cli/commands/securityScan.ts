import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { scanForVulnerabilities } from '../../core/search/securityScan.js'

export function securityScanCommand(): Command {
  return new Command('security-scan')
    .description('Scan the codebase for common security patterns (semantic + keyword)')
    .option('--top <n>', 'top results per pattern', '10')
    .option('--model <model>', 'embedding model to use')
    .action(async (opts: { top?: string; model?: string }) => {
      const session = getActiveSession()
      const top = parseInt(opts.top ?? '10', 10)
      const findings = await scanForVulnerabilities(session, { model: opts.model }, { top, model: opts.model } as any)
      for (const f of findings) console.log(`${f.patternName}\t${f.blobHash}\t${f.score}`)
    })
}
