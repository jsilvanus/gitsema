import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTool } from '../registerTool.js'
import { getTextProvider } from '../../core/embedding/providerFactory.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { computeConceptChangePoints } from '../../core/search/changePoints.js'
import { computeExperts } from '../../core/search/experts.js'
import { computeImpact } from '../../core/search/impact.js'
import { computeAuthorContributions } from '../../core/search/authorSearch.js'
import { computeExperts as computeExpertsAlias } from '../../core/search/experts.js'
import { getActiveSession } from '../../core/db/sqlite.js'
import { scoreDebt } from '../../core/search/debtScoring.js'
import { scanForVulnerabilities } from '../../core/search/securityScan.js'

export function registerWorkflowTools(server: McpServer) {
  // triage
  registerTool(
    server,
    'triage',
    'Incident / issue triage bundle: for a query, returns first-seen blobs, concept change points, optional file evolution, bisect analysis, and expert attribution.',
    {
      query: z.string().describe('Natural-language query describing the issue or incident'),
      top: z.number().int().positive().optional().default(5).describe('Max results per section'),
      file: z.string().optional().describe('Optional file path for file-level evolution analysis'),
    },
    async ({ query, top, file }, { embed }) => {
      const provider = getTextProvider()
      const eRes = await embed(provider, query, 'Error embedding query')
      if (!eRes.ok) return eRes.resp
      const emb = eRes.embedding!
      const sections: Record<string, unknown> = {}
      try { sections.firstSeen = vectorSearch(emb, { topK: top }) } catch (e) { sections.firstSeen = [] }
      try { sections.changePoints = computeConceptChangePoints(query, emb, { topK: top }) } catch (e) { sections.changePoints = [] }
      try { sections.experts = computeExpertsAlias({ topN: top }) } catch (e) { sections.experts = [] }
      if (file) {
        try {
          const { computeEvolution } = await import('../../core/search/evolution.js')
          sections.fileEvolution = computeEvolution(file)
        } catch (e) { sections.fileEvolution = [] }
      }
      const lines: string[] = [`Triage: "${query}"`]
      for (const [key, val] of Object.entries(sections)) {
        lines.push(`\n--- ${key} ---`)
        lines.push(typeof val === 'string' ? val : JSON.stringify(val, null, 2))
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // workflow_run
  registerTool(
    server,
    'workflow_run',
    'Run a named workflow template (pr-review | incident | release-audit) and return all sections of the analysis bundle.',
    {
      template: z.enum(['pr-review', 'incident', 'release-audit']).describe('Workflow template to run'),
      query: z.string().optional().describe('Query string (required for incident and release-audit)'),
      file: z.string().optional().describe('File path (used by pr-review for impact analysis)'),
      top: z.number().int().positive().optional().default(5).describe('Max results per section'),
    },
    async ({ template, query, file, top }, { embed }) => {
      const provider = getTextProvider()
      const sections: Record<string, unknown> = {}

      if (template === 'pr-review') {
        const q = query ?? file ?? 'code changes'
        const eRes = await embed(provider, q, 'Error embedding query')
        if (!eRes.ok) return eRes.resp
        const emb = eRes.embedding!
        if (file) {
          try { sections.impact = await computeImpact(file, provider, { topK: top }) } catch (e) { sections.impact = [] }
        }
        try { sections.changePoints = computeConceptChangePoints(q, emb, { topK: top }) } catch (e) { sections.changePoints = [] }
        try { sections.experts = computeExpertsAlias({ topN: top }) } catch (e) { sections.experts = [] }
      } else if (template === 'incident') {
        const q = query ?? ''
        const eRes = await embed(provider, q, 'Error embedding query')
        if (!eRes.ok) return eRes.resp
        const emb = eRes.embedding!
        try { sections.firstSeen = vectorSearch(emb, { topK: top }) } catch (e) { sections.firstSeen = [] }
        try { sections.changePoints = computeConceptChangePoints(q, emb, { topK: top }) } catch (e) { sections.changePoints = [] }
        try { sections.experts = computeExpertsAlias({ topN: top }) } catch (e) { sections.experts = [] }
      } else {
        const q = query ?? 'architecture changes quality'
        const eRes = await embed(provider, q, 'Error embedding query')
        if (!eRes.ok) return eRes.resp
        const emb = eRes.embedding!
        try { sections.topChangedConcepts = vectorSearch(emb, { topK: top }) } catch (e) { sections.topChangedConcepts = [] }
        try { sections.changePoints = computeConceptChangePoints(q, emb, { topK: top }) } catch (e) { sections.changePoints = [] }
        try { sections.experts = computeExpertsAlias({ topN: top }) } catch (e) { sections.experts = [] }
      }

      const lines: string[] = [`Workflow: ${template}`]
      for (const [key, val] of Object.entries(sections)) {
        lines.push(`\n--- ${key} ---`)
        lines.push(typeof val === 'string' ? val : JSON.stringify(val, null, 2))
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // policy_check
  registerTool(
    server,
    'policy_check',
    'CI policy gate: check index health against thresholds for debt score, security similarity, and concept drift. Returns pass/fail for each gate.',
    {
      max_debt_score: z.number().min(0).max(1).optional().describe('Fail if average debt score exceeds this threshold'),
      min_security_score: z.number().min(0).max(1).optional().describe('Fail if max security similarity exceeds this threshold'),
      max_drift: z.number().min(0).max(2).optional().describe('Fail if max concept drift distance exceeds this threshold (requires query)'),
      query: z.string().optional().describe('Query for drift analysis (required when max_drift is set)'),
    },
    async ({ max_debt_score, min_security_score, max_drift, query }, { embed }) => {
      const provider = getTextProvider()
      const session = getActiveSession()
      const results: { passed: boolean; checks: Record<string, { passed: boolean; [k: string]: unknown }> } = { passed: true, checks: {} }

      if (max_debt_score !== undefined) {
        try {
          const debtItems = await scoreDebt(session, provider)
          const avgScore = debtItems.length > 0 ? debtItems.reduce((s, r) => s + r.debtScore, 0) / debtItems.length : 0
          const passed = avgScore <= max_debt_score
          results.checks.debt = { avgScore, passed }
          if (!passed) results.passed = false
        } catch (err) {
          results.checks.debt = { passed: false, error: err instanceof Error ? err.message : String(err) }
          results.passed = false
        }
      }
      if (min_security_score !== undefined) {
        try {
          const findings = await scanForVulnerabilities(session, provider)
          const maxSim = findings.length > 0 ? Math.max(...findings.map((f) => f.score)) : 0
          const passed = maxSim <= min_security_score
          results.checks.security = { maxSimilarity: maxSim, passed }
          if (!passed) results.passed = false
        } catch (err) {
          results.checks.security = { passed: false, error: err instanceof Error ? err.message : String(err) }
          results.passed = false
        }
      }
      if (max_drift !== undefined && query) {
        try {
          const eRes = await embed(provider, query, 'Error embedding query')
          if (!eRes.ok) return eRes.resp
          const emb = eRes.embedding!
          const cps = computeConceptChangePoints(query, emb, { topK: 50 })
          const maxDist = cps.points.length > 0 ? Math.max(...cps.points.map((c) => c.distance)) : 0
          const passed = maxDist <= max_drift
          results.checks.drift = { maxDistance: maxDist, passed }
          if (!passed) results.passed = false
        } catch (err) {
          results.checks.drift = { passed: false, error: err instanceof Error ? err.message : String(err) }
          results.passed = false
        }
      }

      const summary = results.passed ? '✅ All policy checks passed.' : '❌ Policy check FAILED.'
      const lines = [summary]
      for (const [gate, info] of Object.entries(results.checks)) {
        const icon = info.passed ? '✅' : '❌'
        lines.push(`  ${icon} ${gate}: ${JSON.stringify(info)}`)
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )
}
