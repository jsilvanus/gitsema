import { writeFileSync } from 'node:fs'
import { buildProvider, applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { computeExperts } from '../../core/search/experts.js'
import { computeConceptChangePoints } from '../../core/search/changePoints.js'
import { computeSemanticBisect } from '../../core/search/semanticBisect.js'
import { computeEvolution } from '../../core/search/evolution.js'
import { parsePositiveInt } from '../../utils/parse.js'

export interface TriageOptions {
  ref1?: string
  ref2?: string
  file?: string
  dump?: string | boolean
  top?: string
  model?: string
  textModel?: string
  codeModel?: string
}

export async function triageCommand(query: string, options: TriageOptions): Promise<void> {
  if (!query || query.trim() === '') {
    console.error('Error: query is required')
    process.exit(1)
  }

  const top = options.top ? parsePositiveInt(options.top, '--top') : 5
  applyModelOverrides({
    model: options.model,
    textModel: options.textModel,
    codeModel: options.codeModel,
  })

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  let provider
  try {
    provider = buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  let queryEmbedding
  try {
    queryEmbedding = await embedQuery(provider!, query)
  } catch (err) {
    console.error(`Error embedding query: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const output: Record<string, unknown> = { query, sections: {} as Record<string, unknown> }
  const sections = output.sections as Record<string, unknown>

  // First Seen — show top matching blobs sorted by first-seen date
  try {
    const hits = vectorSearch(queryEmbedding!, { topK: top })
    sections.firstSeen = hits
  } catch (err) {
    sections.firstSeen = { error: err instanceof Error ? err.message : String(err) }
  }

  // Change Points
  try {
    const cps = computeConceptChangePoints(query, queryEmbedding!, { topK: top })
    sections.changePoints = cps
  } catch (err) {
    sections.changePoints = { error: err instanceof Error ? err.message : String(err) }
  }

  // File Evolution (optional)
  if (options.file) {
    try {
      const fe = computeEvolution(options.file)
      sections.fileEvolution = fe
    } catch (err) {
      sections.fileEvolution = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Bisect — find which commit caused the biggest semantic shift
  try {
    const ref1 = options.ref1 ?? 'HEAD~10'
    const ref2 = options.ref2 ?? 'HEAD'
    const bisect = computeSemanticBisect(queryEmbedding!, query, ref1, ref2, { topK: top })
    sections.bisect = bisect
  } catch (err) {
    sections.bisect = { error: err instanceof Error ? err.message : String(err) }
  }

  // Experts — who worked on this concept area
  try {
    const experts = computeExperts({ topN: top })
    sections.experts = experts
  } catch (err) {
    sections.experts = { error: err instanceof Error ? err.message : String(err) }
  }

  if (options.dump !== undefined) {
    const json = JSON.stringify(output, null, 2)
    if (typeof options.dump === 'string' && options.dump !== '') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`Triage JSON written to: ${options.dump}`)
    } else {
      process.stdout.write(json + '\n')
    }
    return
  }

  // Human-readable output
  console.log(`\n=== TRIAGE REPORT: "${query}" ===\n`)

  console.log('── First Seen ──')
  const fsHits = sections.firstSeen as Array<{ path?: string; score?: number; firstSeen?: string }> | { error: string }
  if ('error' in (fsHits as object)) {
    console.log(`  (error: ${(fsHits as { error: string }).error})`)
  } else {
    const hits = fsHits as Array<{ path?: string; score?: number; firstSeen?: string }>
    for (const h of hits.slice(0, top)) {
      console.log(`  ${h.path ?? '?'}  score=${(h.score ?? 0).toFixed(4)}`)
    }
  }

  console.log('\n── Change Points ──')
  const cpReport = sections.changePoints as { points?: Array<{ before: { date: string; commit: string }; after: { date: string; commit: string }; distance: number }> } | { error: string }
  if ('error' in (cpReport as object)) {
    console.log(`  (error: ${(cpReport as { error: string }).error})`)
  } else {
    const pts = (cpReport as { points?: Array<{ before: { date: string; commit: string }; after: { date: string; commit: string }; distance: number }> }).points ?? []
    if (pts.length === 0) {
      console.log('  No significant change points found.')
    }
    for (const p of pts.slice(0, top)) {
      console.log(`  ${p.before.date} → ${p.after.date}  Δ=${p.distance.toFixed(4)}  commits: ${p.before.commit.slice(0, 7)}→${p.after.commit.slice(0, 7)}`)
    }
  }

  if (sections.fileEvolution !== undefined) {
    console.log('\n── File Evolution ──')
    const fe = sections.fileEvolution as Array<{ date?: string; distance?: number }> | { error: string }
    if ('error' in (fe as object)) {
      console.log(`  (error: ${(fe as { error: string }).error})`)
    } else {
      const entries = fe as Array<{ date?: string; distance?: number }>
      for (const e of entries.slice(0, top)) {
        console.log(`  ${e.date ?? '?'}  Δ=${((e.distance ?? 0)).toFixed(4)}`)
      }
    }
  }

  console.log('\n── Bisect ──')
  const bisect = sections.bisect as { culpritRef?: string; maxShift?: number } | { error: string }
  if ('error' in (bisect as object)) {
    console.log(`  (error: ${(bisect as { error: string }).error})`)
  } else {
    const b = bisect as { culpritRef?: string; maxShift?: number }
    console.log(`  Culprit: ${b.culpritRef ?? '?'}  max shift: ${(b.maxShift ?? 0).toFixed(4)}`)
  }

  console.log('\n── Experts ──')
  const experts = sections.experts as Array<{ authorName: string; blobCount: number }> | { error: string }
  if ('error' in (experts as object)) {
    console.log(`  (error: ${(experts as { error: string }).error})`)
  } else {
    const exp = experts as Array<{ authorName: string; blobCount: number }>
    for (const e of exp.slice(0, top)) {
      console.log(`  ${e.authorName}  blobs=${e.blobCount}`)
    }
  }

  console.log('')
}
