import { resolve } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import {
  computeImpact,
  type ImpactReport,
  type ImpactResult,
  type ModuleGroup,
} from '../../core/search/impact.js'
import { shortHash } from '../../core/search/ranking.js'

export interface ImpactCommandOptions {
  /** Number of similar blobs to return (default 10). */
  top?: string
  /** When true, include chunk-level embeddings for finer-grained coupling. */
  chunks?: boolean
  /**
   * When present, write JSON output.  A string value is the output file path;
   * boolean `true` means print JSON to stdout.
   */
  dump?: string | boolean
  /** When set, restrict results to blobs seen on this branch. */
  branch?: string
}

function buildProviderOrExit(providerType: string, model: string): EmbeddingProvider {
  try {
    return buildProvider(providerType, model)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
    throw err
  }
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
function renderReport(report: ImpactReport): string {
  const lines: string[] = []

  lines.push(`Refactor impact: ${report.targetPath}`)
  if (report.targetBlobHash) {
    lines.push(`Target blob: ${shortHash(report.targetBlobHash)}`)
  }
  lines.push('')

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

  const resolvedPath = resolve(filePath.trim())
  if (!existsSync(resolvedPath)) {
    console.error(`Error: file not found: ${resolvedPath}`)
    process.exit(1)
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProviderOrExit(providerType, model)

  let report: ImpactReport = { targetPath: filePath, targetBlobHash: null, results: [], moduleGroups: [] }
  try {
    report = await computeImpact(resolvedPath, provider, {
      topK,
      searchChunks: options.chunks ?? false,
      branch: options.branch,
    })
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (options.dump !== undefined) {
    const json = JSON.stringify(report, null, 2)
    if (typeof options.dump === 'string') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`Wrote impact report JSON to ${options.dump}`)
    } else {
      console.log(json)
    }
    return
  }

  console.log(renderReport(report))
}
