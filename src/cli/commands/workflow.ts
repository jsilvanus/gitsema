import { writeFileSync } from 'node:fs'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { computeImpact } from '../../core/search/impact.js'
import { computeConceptChangePoints } from '../../core/search/changePoints.js'
import { computeExperts } from '../../core/search/experts.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { parsePositiveInt } from '../../utils/parse.js'
import { computeAuthorContributions } from '../../core/search/authorSearch.js'
import { scoreDebt } from '../../core/search/debtScoring.js'
import { computeHealthTimeline } from '../../core/search/healthTimeline.js'
import { getActiveSession } from '../../core/db/sqlite.js'

export interface WorkflowOptions {
  dump?: string | boolean
  format?: string
  /** Unified output spec (repeatable) */
  out?: string[]
  base?: string
  file?: string
  query?: string
  top?: string
  model?: string
  textModel?: string
  codeModel?: string
  /** Role hint for onboarding pattern (e.g. auth, billing, frontend) */
  role?: string
  /** For regression-forecast: ref to compare against HEAD */
  ref?: string
}

/** All 8 productized usage patterns (review7 §5). */
const TEMPLATES = [
  'pr-review',        // 1. PR Semantic Risk Gate
  'release-audit',    // 2. Release Narrative Pack
  'onboarding',       // 3. Onboarding Assistant
  'incident',         // 4. Incident Triage Console
  'ownership-intel',  // 5. Ownership Intelligence
  'arch-drift',       // 6. Architecture Drift Monitor
  'knowledge-portal', // 7. Knowledge Discovery Portal
  'regression-forecast', // 8. Regression Forecasting
] as const
type Template = typeof TEMPLATES[number]

/** Human-readable descriptions for each pattern. */
export const TEMPLATE_DESCRIPTIONS: Record<Template, string> = {
  'pr-review':           'PR Semantic Risk Gate — policy + change-points + security impact (--file <path>)',
  'release-audit':       'Release Narrative Pack — concept evolution + change-points + expert ownership',
  'onboarding':          'Onboarding Assistant — role-focused semantic tour (--role <topic>, e.g. auth)',
  'incident':            'Incident Triage Console — first-seen + change-points + expert contacts (--query <text>)',
  'ownership-intel':     'Ownership Intelligence — semantic author contributions for reviewer suggestions (--query <text>)',
  'arch-drift':          'Architecture Drift Monitor — health timeline + debt score snapshots',
  'knowledge-portal':    'Knowledge Discovery Portal — broad concept search for platform/multi-team discovery (--query <text>)',
  'regression-forecast': 'Regression Forecasting — semantic neighbourhood shift pre/post refactor (--query <text>, --ref <base-ref>)',
}

/** Print a list of all available workflow templates with descriptions. */
export function workflowListCommand(): void {
  console.log('Available workflow patterns (use: gitsema workflow run <pattern>):\n')
  for (const tmpl of TEMPLATES) {
    console.log(`  ${tmpl.padEnd(22)} ${TEMPLATE_DESCRIPTIONS[tmpl as Template]}`)
  }
}

export async function workflowCommand(
  template: string,
  _args: string[],
  options: WorkflowOptions,
): Promise<void> {
  if (!TEMPLATES.includes(template as Template)) {
    console.error(`Unknown template: "${template}". Available: ${TEMPLATES.join(', ')}`)
    process.exit(1)
  }

  applyModelOverrides({
    model: options.model,
    textModel: options.textModel,
    codeModel: options.codeModel,
  })

  const fmt = options.format ?? 'markdown'
  const top = options.top ? parsePositiveInt(options.top, '--top') : 5
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  let provider
  try {
    provider = buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const out: Record<string, unknown> = { template, sections: {} as Record<string, unknown> }
  const sections = out.sections as Record<string, unknown>

  // ── 1. pr-review — PR Semantic Risk Gate ─────────────────────────────────
  if (template === 'pr-review') {
    if (!options.file) {
      console.error('Error: --file <path> is required for the pr-review template')
      process.exit(1)
    }
    try {
      const impact = await computeImpact(options.file!, provider!, { topK: top })
      sections.impact = impact
    } catch (err) {
      sections.impact = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      const query = options.query ?? options.file ?? ''
      const emb = await embedQuery(provider!, query)
      const cps = computeConceptChangePoints(query, emb, { topK: top })
      sections.changePoints = cps
    } catch (err) {
      sections.changePoints = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.experts = computeExperts({ topN: top })
    } catch (err) {
      sections.experts = { error: err instanceof Error ? err.message : String(err) }
    }

  // ── 2. release-audit — Release Narrative Pack ────────────────────────────
  } else if (template === 'release-audit') {
    const query = options.query ?? 'architecture changes quality'
    let emb
    try {
      emb = await embedQuery(provider!, query)
    } catch (err) {
      console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    try {
      sections.topChangedConcepts = vectorSearch(emb!, { topK: top })
    } catch (err) {
      sections.topChangedConcepts = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.changePoints = computeConceptChangePoints(query, emb!, { topK: top })
    } catch (err) {
      sections.changePoints = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.experts = computeExperts({ topN: top })
    } catch (err) {
      sections.experts = { error: err instanceof Error ? err.message : String(err) }
    }

  // ── 3. onboarding — Onboarding Assistant ─────────────────────────────────
  } else if (template === 'onboarding') {
    const topic = options.role ?? options.query ?? 'authentication'
    let emb
    try {
      emb = await embedQuery(provider!, topic)
    } catch (err) {
      console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    try {
      sections.relevantBlobs = vectorSearch(emb!, { topK: top })
    } catch (err) {
      sections.relevantBlobs = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.changePoints = computeConceptChangePoints(topic, emb!, { topK: top })
    } catch (err) {
      sections.changePoints = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.keyExperts = computeExperts({ topN: top })
    } catch (err) {
      sections.keyExperts = { error: err instanceof Error ? err.message : String(err) }
    }

  // ── 4. incident — Incident Triage Console ────────────────────────────────
  } else if (template === 'incident') {
    if (!options.query) {
      console.error('Error: --query <text> is required for the incident template')
      process.exit(1)
    }
    let emb
    try {
      emb = await embedQuery(provider!, options.query!)
    } catch (err) {
      console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    try {
      sections.firstSeen = vectorSearch(emb!, { topK: top })
    } catch (err) {
      sections.firstSeen = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.changePoints = computeConceptChangePoints(options.query!, emb!, { topK: top })
    } catch (err) {
      sections.changePoints = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.experts = computeExperts({ topN: top })
    } catch (err) {
      sections.experts = { error: err instanceof Error ? err.message : String(err) }
    }

  // ── 5. ownership-intel — Ownership Intelligence ───────────────────────────
  } else if (template === 'ownership-intel') {
    if (!options.query) {
      console.error('Error: --query <text> is required for the ownership-intel template')
      process.exit(1)
    }
    let emb
    try {
      emb = await embedQuery(provider!, options.query!)
    } catch (err) {
      console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    try {
      const contributions = await computeAuthorContributions(emb!, { topAuthors: top })
      sections.suggestedReviewers = contributions.map((c) => ({
        author: c.authorName,
        email: c.authorEmail,
        score: c.totalScore,
        blobCount: c.blobCount,
      }))
    } catch (err) {
      sections.suggestedReviewers = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.topResults = vectorSearch(emb!, { topK: top })
    } catch (err) {
      sections.topResults = { error: err instanceof Error ? err.message : String(err) }
    }

  // ── 6. arch-drift — Architecture Drift Monitor ───────────────────────────
  } else if (template === 'arch-drift') {
    try {
      const db = getActiveSession()
      sections.health = computeHealthTimeline(db, { buckets: Math.min(top, 12) })
    } catch (err) {
      sections.health = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      const db = getActiveSession()
      sections.debt = await scoreDebt(db, provider!, { top })
    } catch (err) {
      sections.debt = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.changePoints = computeConceptChangePoints(
        options.query ?? 'architecture structure modules',
        await embedQuery(provider!, options.query ?? 'architecture structure modules'),
        { topK: top },
      )
    } catch (err) {
      sections.changePoints = { error: err instanceof Error ? err.message : String(err) }
    }

  // ── 7. knowledge-portal — Knowledge Discovery Portal ─────────────────────
  } else if (template === 'knowledge-portal') {
    if (!options.query) {
      console.error('Error: --query <text> is required for the knowledge-portal template')
      process.exit(1)
    }
    let emb
    try {
      emb = await embedQuery(provider!, options.query!)
    } catch (err) {
      console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    try {
      sections.results = vectorSearch(emb!, { topK: top })
    } catch (err) {
      sections.results = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.relatedConcepts = computeConceptChangePoints(options.query!, emb!, { topK: top })
    } catch (err) {
      sections.relatedConcepts = { error: err instanceof Error ? err.message : String(err) }
    }
    try {
      sections.owners = computeExperts({ topN: top })
    } catch (err) {
      sections.owners = { error: err instanceof Error ? err.message : String(err) }
    }

  // ── 8. regression-forecast — Regression Forecasting ──────────────────────
  } else if (template === 'regression-forecast') {
    if (!options.query) {
      console.error('Error: --query <text> is required for the regression-forecast template')
      process.exit(1)
    }
    let emb
    try {
      emb = await embedQuery(provider!, options.query!)
    } catch (err) {
      console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    // Current neighbourhood (HEAD)
    try {
      sections.currentNeighbourhood = vectorSearch(emb!, { topK: top })
    } catch (err) {
      sections.currentNeighbourhood = { error: err instanceof Error ? err.message : String(err) }
    }
    // Change-point trajectory around the concept
    try {
      sections.changePoints = computeConceptChangePoints(options.query!, emb!, { topK: top })
    } catch (err) {
      sections.changePoints = { error: err instanceof Error ? err.message : String(err) }
    }
    // Risk signal: who knows this area (for reviewer assignment on refactor)
    try {
      sections.riskOwners = computeExperts({ topN: top })
    } catch (err) {
      sections.riskOwners = { error: err instanceof Error ? err.message : String(err) }
    }
    if (options.ref) {
      sections.baseRef = options.ref
      sections.note = 'Run `gitsema diff <ref> HEAD <query>` for a full semantic diff between refs.'
    }
  }

  // ── output ────────────────────────────────────────────────────────────────
  // --out takes priority; fall back to --dump / --format for backward compat.
  const sinks = resolveOutputs({ out: options.out, dump: options.dump, format: fmt === 'json' ? 'json' : undefined })
  const jsonSink = getSink(sinks, 'json')
  const mdSink = getSink(sinks, 'markdown')

  if (jsonSink) {
    const json = JSON.stringify(out, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Workflow JSON written to: ${jsonSink.file}`)
    } else {
      process.stdout.write(json + '\n')
    }
    if (!hasSinkFormat(sinks, 'text') && !hasSinkFormat(sinks, 'markdown')) return
  }

  if (fmt === 'json' && !jsonSink) {
    console.log(JSON.stringify(out, null, 2))
    return
  }

  // Markdown output (default)
  console.log(`# Workflow: ${template}`)
  console.log('')
  for (const [key, val] of Object.entries(sections)) {
    console.log(`## ${key}`)
    console.log('```json')
    console.log(JSON.stringify(val, null, 2))
    console.log('```')
    console.log('')
  }
}
