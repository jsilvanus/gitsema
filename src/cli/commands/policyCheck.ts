import { writeFileSync } from 'node:fs'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { computeConceptChangePoints } from '../../core/search/temporal/changePoints.js'
import { scoreDebt } from '../../core/search/debtScoring.js'
import { scanForVulnerabilities } from '../../core/search/securityScan.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import { parsePositiveFloat } from '../../utils/parse.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { buildProviderOrExit, resolveModels } from '../lib/provider.js'
import { EXIT_USAGE, EXIT_RUNTIME, EXIT_GATE_FAILED } from '../lib/errors.js'

export interface PolicyCheckOptions {
  maxDrift?: string
  maxDebtScore?: string
  minSecurityScore?: string
  query?: string
  dump?: string | boolean
  /** Unified output spec (repeatable) */
  out?: string[]
  model?: string
  textModel?: string
  codeModel?: string
}

interface PolicyResults {
  passed: boolean
  checks: {
    debt?: { avgScore: number; passed: boolean }
    security?: { maxSimilarity: number; passed: boolean }
    drift?: { maxDistance: number; passed: boolean }
  }
}

export async function policyCheckCommand(options: PolicyCheckOptions): Promise<void> {
  const { providerType, textModel } = resolveModels({
    model: options.model,
    textModel: options.textModel,
    codeModel: options.codeModel,
  })
  const buildPolicyProvider = (): EmbeddingProvider => buildProviderOrExit(providerType, textModel, EXIT_RUNTIME)
  const session = getActiveSession()

  const results: PolicyResults = { passed: true, checks: {} }

  // ── Debt score gate ─────────────────────────────────────────────────────
  if (options.maxDebtScore !== undefined) {
    let maxDebt: number
    try {
      maxDebt = parsePositiveFloat(options.maxDebtScore, '--max-debt-score')
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(EXIT_USAGE)
    }
    const provider = buildPolicyProvider()
    let debtResults
    try {
      debtResults = await scoreDebt(session, provider)
    } catch (err) {
      console.error(`Error computing debt score: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(EXIT_RUNTIME)
    }
    const avgScore = debtResults!.length > 0
      ? debtResults!.reduce((sum, r) => sum + r.debtScore, 0) / debtResults!.length
      : 0
    const passed = avgScore <= maxDebt!
    results.checks.debt = { avgScore, passed }
    if (!passed) results.passed = false
  }

  // ── Security gate ───────────────────────────────────────────────────────
  if (options.minSecurityScore !== undefined) {
    let minSec: number
    try {
      minSec = parsePositiveFloat(options.minSecurityScore, '--min-security-score')
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(EXIT_USAGE)
    }
    const provider = buildPolicyProvider()
    let findings
    try {
      findings = await scanForVulnerabilities(session, provider)
    } catch (err) {
      console.error(`Error running security scan: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(EXIT_RUNTIME)
    }
    // Higher similarity = closer match to vulnerability pattern = more risky.
    // Gate fails if any finding exceeds the user's threshold.
    const maxSim = findings!.length > 0 ? Math.max(...findings!.map((f) => f.score)) : 0
    const passed = maxSim <= minSec!
    results.checks.security = { maxSimilarity: maxSim, passed }
    if (!passed) results.passed = false
  }

  // ── Drift gate ──────────────────────────────────────────────────────────
  if (options.maxDrift !== undefined) {
    if (!options.query) {
      console.error('Error: --query is required when using --max-drift')
      process.exit(EXIT_USAGE)
    }
    let maxDrift: number
    try {
      maxDrift = parsePositiveFloat(options.maxDrift, '--max-drift')
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(EXIT_USAGE)
    }
    const provider = buildPolicyProvider()
    let emb
    try {
      emb = await embedQuery(provider, options.query!)
    } catch (err) {
      console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(EXIT_RUNTIME)
    }
    const cps = computeConceptChangePoints(options.query!, emb!, { topK: 50 })
    const maxDist = cps.points.length > 0
      ? Math.max(...cps.points.map((c) => c.distance))
      : 0
    const passed = maxDist <= maxDrift!
    results.checks.drift = { maxDistance: maxDist, passed }
    if (!passed) results.passed = false
  }

  // ── Output ──────────────────────────────────────────────────────────────
  const sinks = resolveOutputs({ out: options.out, dump: options.dump })
  const jsonSink = getSink(sinks, 'json')
  if (jsonSink) {
    const json = JSON.stringify(results, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Policy check JSON written to: ${jsonSink.file}`)
    } else {
      process.stdout.write(json + '\n')
    }
    if (!hasSinkFormat(sinks, 'text') && results.passed) return
    if (!hasSinkFormat(sinks, 'text') && !results.passed) {
      process.exit(EXIT_GATE_FAILED)
    }
  }

  if (!jsonSink || hasSinkFormat(sinks, 'text')) {
    if (results.passed) {
      console.log('✅  Policy check passed')
    } else {
      console.log('❌  Policy check FAILED')
      for (const [key, val] of Object.entries(results.checks)) {
        const v = val as { passed: boolean; [k: string]: unknown }
        const icon = v.passed ? '✓' : '✗'
        const detail = Object.entries(v)
          .filter(([k]) => k !== 'passed')
          .map(([k, x]) => `${k}=${typeof x === 'number' ? (x as number).toFixed(4) : x}`)
          .join('  ')
        console.log(`  ${icon}  ${key}: ${detail}`)
      }
    }
  }

  if (!results.passed) process.exit(EXIT_GATE_FAILED)
}
