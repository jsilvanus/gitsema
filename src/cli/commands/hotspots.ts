/**
 * `gitsema hotspots` (Phase 110, knowledge-graph §8): rank files by
 * architectural risk = co-change (temporal) × call-coupling (structural) ×
 * churn. Default lens: hybrid (all three signals).
 */

import { writeFileSync } from 'node:fs'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { computeHotspots, churnByPath, type HotspotsResult } from '../../core/graph/hotspots.js'
import { subgraphFromHotspots } from '../../core/graph/subgraphView.js'
import { parseLens, type Lens } from '../lib/lens.js'
import { resolveOutputs, getSink, hasSinkFormat, type OutputSpec } from '../../utils/outputSink.js'
import { emitSubgraphOutputs } from '../lib/graphOutput.js'

export interface HotspotsCommandOptions {
  lens?: string
  top?: string
  /** Accepted from the shared `--lens` helper; not meaningful for the geometric-mean risk score. */
  weightStructural?: string
  dump?: string | boolean
  out?: string[]
}

/** Renders a `HotspotsResult` as human-readable text, with per-hit lens labels. */
export function renderHotspots(result: HotspotsResult): string {
  const lines: string[] = []
  lines.push(`Architectural hotspots — lens: ${result.lens}`)
  lines.push('risk = co-change (temporal) × call-coupling (structural) × churn', '')

  if (result.hotspots.length === 0) {
    lines.push('No hotspots found. Run `gitsema index --graph` then `gitsema graph build` first.')
    return lines.join('\n')
  }

  for (let i = 0; i < result.hotspots.length; i++) {
    const h = result.hotspots[i]
    const rank = String(i + 1).padStart(2)
    const label = h.lenses.length > 0 ? ` [${h.lenses.join('+')}]` : ''
    lines.push(`${rank}. ${h.risk.toFixed(3)}  ${h.path}${label}`)
    lines.push(`    co-change=${h.coChange} (${h.coChangeNorm.toFixed(2)})  coupling=${h.coupling} (${h.couplingNorm.toFixed(2)})  churn=${h.churn} (${h.churnNorm.toFixed(2)})`)
  }
  return lines.join('\n')
}

export async function hotspotsCommand(options: HotspotsCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const lens: Lens = parseLens(options.lens, 'hybrid')
  const topK = options.top !== undefined ? parseInt(options.top, 10) : undefined

  // Churn is sqlite-only; on other backends it degrades to an empty map and the
  // hybrid/semantic lenses fall back to their structural component.
  let churn = new Map<string, number>()
  if (profile.backend === 'sqlite') {
    try {
      churn = churnByPath()
    } catch {
      churn = new Map()
    }
  }

  const result = await computeHotspots(profile.graph, { lens, topK, churnByPath: churn })

  const sinks = resolveOutputs({ out: options.out, dump: options.dump })
  const jsonSink = getSink(sinks, 'json')
  if (jsonSink) {
    const json = JSON.stringify(result, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Hotspots JSON written to: ${jsonSink.file}`)
    } else {
      process.stdout.write(json + '\n')
    }
    if (!hasSinkFormat(sinks, 'text') && !hasSinkFormat(sinks, 'html') && !hasSinkFormat(sinks, 'markdown')) return
  }

  const graphSinks = [getSink(sinks, 'html'), getSink(sinks, 'markdown')].filter((s): s is OutputSpec => s !== undefined)
  if (graphSinks.length > 0) {
    const sub = await subgraphFromHotspots(profile.graph, result.hotspots)
    emitSubgraphOutputs(graphSinks, sub, 'Architectural hotspots')
    if (!hasSinkFormat(sinks, 'text')) return
  }

  console.log(renderHotspots(result))
}
