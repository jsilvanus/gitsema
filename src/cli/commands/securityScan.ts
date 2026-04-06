import { writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { scanForVulnerabilities } from '../../core/search/securityScan.js'
import { toSarif } from '../../core/search/sarifOutput.js'
import { parsePositiveInt } from '../../utils/parse.js'

export function securityScanCommand(): Command {
  return new Command('security-scan')
    .description('Scan the codebase for common security patterns (semantic + structural heuristics)')
    .option('--top <n>', 'top results per pattern', '10')
    .option('--model <model>', 'embedding model to use')
    .option('--dump [file]', 'output JSON to file or stdout')
    .option('--sarif [file]', 'output SARIF 2.1.0 format to file or stdout')
    .option('--high-confidence-only', 'only report findings with both semantic + structural signal')
    .action(async (opts: { top?: string; model?: string; dump?: string | boolean; sarif?: string | boolean; highConfidenceOnly?: boolean }) => {
      let top: number
      try {
        top = parsePositiveInt(opts.top ?? '10', '--top')
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
      const session = getActiveSession()
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = opts.model ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)
      let findings = await scanForVulnerabilities(session, provider, { top, model })

      if (opts.highConfidenceOnly) {
        findings = findings.filter((f) => f.confidence === 'high')
      }

      if (opts.sarif !== undefined) {
        // Read version from package.json for SARIF tool version
        let toolVersion = '0.0.0'
        try {
          const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))
          toolVersion = pkg.version ?? '0.0.0'
        } catch { /* fall back */ }
        const sarif = toSarif(findings, toolVersion)
        if (typeof opts.sarif === 'string') {
          writeFileSync(opts.sarif, sarif, 'utf8')
          console.log(`SARIF report written to: ${opts.sarif}`)
        } else {
          process.stdout.write(sarif + '\n')
        }
        return
      }

      if (opts.dump !== undefined) {
        const json = JSON.stringify(findings, null, 2)
        if (typeof opts.dump === 'string') {
          writeFileSync(opts.dump, json, 'utf8')
          console.log(`Security findings written to: ${opts.dump}`)
        } else {
          process.stdout.write(json + '\n')
        }
        return
      }
      console.log('# Results are semantic similarity scores, not confirmed vulnerabilities. Manual review required.')
      if (findings.length === 0) {
        console.log('No potential vulnerabilities detected.')
        return
      }
      for (const f of findings) {
        const conf = f.confidence === 'high' ? '🔴 HIGH' : f.confidence === 'structural' ? '🟡 STRUCT' : '🟠 MED'
        const heuristic = f.heuristicMatches?.length ? ` [heuristic: ${f.heuristicMatches[0].slice(0, 60)}]` : ''
        console.log(`[${f.patternName}]  ${conf}  score=${f.score.toFixed(3)}  ${f.blobHash.slice(0, 8)}  ${f.paths.join(', ')}${heuristic}`)
      }
    })
}
