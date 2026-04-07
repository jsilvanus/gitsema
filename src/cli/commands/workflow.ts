import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { computeImpact } from '../../core/search/impact.js'
import { computeConceptChangePoints } from '../../core/search/changePoints.js'
import { computeExperts } from '../../core/search/experts.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { parsePositiveInt } from '../../utils/parse.js'

export interface WorkflowOptions {
  dump?: string | boolean
  format?: string
  base?: string
  file?: string
  query?: string
  top?: string
  model?: string
  textModel?: string
  codeModel?: string
}

const TEMPLATES = ['pr-review', 'incident', 'release-audit'] as const
type Template = typeof TEMPLATES[number]

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

  // ── pr-review ─────────────────────────────────────────────────────────────
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

  // ── incident ──────────────────────────────────────────────────────────────
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

  // ── release-audit ─────────────────────────────────────────────────────────
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
  }

  // ── output ────────────────────────────────────────────────────────────────
  if (options.dump !== undefined) {
    const json = JSON.stringify(out, null, 2)
    if (typeof options.dump === 'string' && options.dump !== '') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`Workflow JSON written to: ${options.dump}`)
    } else {
      process.stdout.write(json + '\n')
    }
    return
  }

  if (fmt === 'json') {
    console.log(JSON.stringify(out, null, 2))
    return
  }

  // Markdown output
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
