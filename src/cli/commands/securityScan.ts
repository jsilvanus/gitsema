import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { scanForVulnerabilities } from '../../core/search/securityScan.js'

export function securityScanCommand(): Command {
  return new Command('security-scan')
    .description('Scan the codebase for common security patterns (semantic + keyword)')
    .option('--top <n>', 'top results per pattern', '10')
    .option('--model <model>', 'embedding model to use')
    .option('--dump [file]', 'output JSON to file or stdout')
    .action(async (opts: { top?: string; model?: string; dump?: string | boolean }) => {
      const session = getActiveSession()
      const top = parseInt(opts.top ?? '10', 10)
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = opts.model ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)
      const findings = await scanForVulnerabilities(session, provider, { top, model })
      if (opts.dump !== undefined) {
        const json = JSON.stringify(findings, null, 2)
        if (typeof opts.dump === 'string') {
          const { writeFileSync } = require('node:fs')
          writeFileSync(opts.dump, json, 'utf8')
          console.log(`Security findings written to: ${opts.dump}`)
        } else {
          process.stdout.write(json + '\n')
        }
        return
      }
      if (findings.length === 0) {
        console.log('No potential vulnerabilities detected.')
        return
      }
      for (const f of findings) {
        console.log(`[${f.patternName}]  score=${f.score.toFixed(3)}  ${f.blobHash.slice(0, 8)}  ${f.paths.join(', ')}`)
      }
    })
}
