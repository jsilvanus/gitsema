import { resolve } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import {
  computeImpact,
  type ImpactReport,
  type ImpactResult,
  type ModuleGroup,
} from '../../core/search/impact.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'
import { shortHash } from '../../core/search/ranking.js'
import { buildProviderOrExit, resolveModels } from '../lib/provider.js'
import { emitJsonSink } from '../lib/output.js'
import { narrateToolResult } from '../../core/llm/narrator.js'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { blastRadius } from '../../core/graph/blastRadius.js'
import { parseLens } from '../lib/lens.js'
import { renderResolutionError, renderBlastRadius } from '../lib/graphRender.js'

export interface ImpactCommandOptions {
  /** Number of similar blobs to return (default 10). */
  top?: string
  /** When true, include chunk-level embeddings for finer-grained coupling. */
  chunks?: boolean
  /** Search level: file (default), chunk, or symbol. */
  level?: string
  /**
   * When present, write JSON output.  A string value is the output file path;
   * boolean `true` means print JSON to stdout.
   */
  dump?: string | boolean
  /** When set, restrict results to blobs seen on this branch. */
  branch?: string
  model?: string
  textModel?: string
  codeModel?: string
  html?: string | boolean
  noHeadings?: boolean
  out?: string[]
  narrate?: boolean
  lens?: string
}

/**
 * Renders module coupling groups as a compact table.
 */
function renderModuleGroups(groups: ModuleGroup[]): string[] {
  if (groups.length === 0) return []
  const lines = ['Cross-module coupling:', '']
  for (const g of groups) {
    const bar = '█'.repeat(Math.round(g.maxScore * 20))
    lines.push(`  ${g.module.padEnd(40)} ${g.maxScore.toFixed(3)}  ${bar}  (${g.count} match${g.count === 1 ? '' : 'es'})`)
  }
  return lines
}

/**
 * Renders impact results as human-readable CLI output.
 */
function renderReport(report: ImpactReport, showHeadings = true): string {
  const lines: string[] = []

  if (showHeadings) {
    lines.push(`Refactor impact: ${report.targetPath}`)
    if (report.targetBlobHash) {
      lines.push(`Target blob: ${shortHash(report.targetBlobHash)}`)
    }
    lines.push('')
  }

  if (report.results.length === 0) {
    lines.push('No semantically coupled blobs found. Run `gitsema index` to populate the index.')
    return lines.join('\n')
  }

  lines.push(`Top ${report.results.length} semantically coupled blob${report.results.length === 1 ? '' : 's'}:`, '')

  for (let i = 0; i < report.results.length; i++) {
    const r = report.results[i]
    const rank = String(i + 1).padStart(2)
    const score = r.score.toFixed(3)
    const pathStr = r.paths[0] ?? '(unknown path)'
    const extra = r.paths.length > 1 ? ` +${r.paths.length - 1} more` : ''
    const lineRange = r.startLine !== undefined ? `:${r.startLine}-${r.endLine}` : ''
    lines.push(`${rank}. ${score}  ${pathStr}${lineRange}${extra}`)
    lines.push(`    blob: ${shortHash(r.blobHash)}  module: ${r.module}`)
    lines.push('')
  }

  const moduleLines = renderModuleGroups(report.moduleGroups)
  if (moduleLines.length > 0) {
    lines.push(...moduleLines)
  }

  return lines.join('\n')
}

export async function impactCommand(
  filePath: string,
  options: ImpactCommandOptions,
): Promise<void> {
  if (!filePath || filePath.trim() === '') {
    console.error('Error: file path is required')
    process.exit(1)
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 10
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  const lens = parseLens(options.lens, 'semantic')

  // Phase 109 (knowledge-graph §8): `--lens structural|hybrid` makes `impact`
  // a thin alias over `blast-radius` — true structural dependents instead of
  // (or alongside) semantic similarity. `--lens semantic` (default) preserves
  // pre-Phase-109 behavior exactly.
  if (lens !== 'semantic') {
    const profile = getCachedStorageProfile(process.cwd())
    const normalised = filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    const result = await blastRadius(profile.graph, normalised, { lens, topK })

    if (result.resolved.status !== 'found') {
      console.log(renderResolutionError(filePath, result.resolved))
      return
    }

    if (options.dump !== undefined || (options.out?.some((o) => o.startsWith('json')))) {
      const jsonSink = getSink(resolveOutputs({ out: options.out, dump: options.dump, html: options.html }), 'json')
      if (jsonSink?.file) {
        writeFileSync(jsonSink.file, JSON.stringify(result, null, 2), 'utf8')
        console.log(`Wrote impact (blast-radius) report JSON to ${jsonSink.file}`)
      } else {
        console.log(JSON.stringify(result, null, 2))
      }
      return
    }

    console.log(renderBlastRadius(result, result.resolved.node))
    return
  }

  const resolvedPath = resolve(filePath.trim())
  if (!existsSync(resolvedPath)) {
    console.error(`Error: file not found: ${resolvedPath}`)
    process.exit(1)
  }

  // Apply CLI model overrides
  const { providerType, textModel: model } = resolveModels({
    model: options.model,
    textModel: options.textModel,
    codeModel: options.codeModel,
  })
  const provider = buildProviderOrExit(providerType, model)

  let report: ImpactReport = { targetPath: filePath, targetBlobHash: null, results: [], moduleGroups: [] }
  try {
    report = await computeImpact(resolvedPath, provider, {
      topK,
      searchChunks: options.level === 'chunk' || (options.chunks ?? false),
      searchSymbols: options.level === 'symbol',
      branch: options.branch,
    })
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: options.html })
  const jsonSink = getSink(sinks, 'json')
  const htmlSink = getSink(sinks, 'html')

  if (emitJsonSink({
    sinks,
    jsonSink,
    payload: report,
    fileMessage: (file) => `Wrote impact report JSON to ${file}`,
    htmlAware: true,
  }).handled) return

  // --html
  if (htmlSink) {
    const { renderImpactHtml } = await import('../../core/viz/htmlRenderer.js')
    const html = renderImpactHtml(report, filePath)
    if (htmlSink.file) {
      writeFileSync(htmlSink.file, html, 'utf8')
      console.log(`Impact HTML written to: ${htmlSink.file}`)
    } else {
      process.stdout.write(html + '\n')
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  console.log(renderReport(report, !options.noHeadings))

  if (options.narrate) {
    console.log('')
    console.log('=== LLM Narrative ===')
    console.log(await narrateToolResult('impact', report))
  }
}
