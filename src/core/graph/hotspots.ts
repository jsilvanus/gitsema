/**
 * `gitsema hotspots` (Phase 110, knowledge-graph §8): architectural risk
 * scoring that fuses all three lenses into one ranking —
 *
 *   risk = co-change (temporal) × call-coupling (structural) × churn
 *
 * Each per-file signal is normalized to [0, 1] against the busiest file in the
 * repo, then combined as a geometric mean over the signals the active lens
 * selects. The geometric mean (rather than a sum) means a file must score on
 * *every* participating axis to rank highly — a file that changes constantly
 * but is structurally isolated, or one that is heavily coupled but never
 * touched, is not a hotspot.
 *
 * Lens → participating signals (knowledge-graph §7.3 defaults `hybrid`):
 *   - `hybrid`     — co-change × coupling × churn (all three lenses)
 *   - `structural` — coupling only (pure structural degree)
 *   - `semantic`   — co-change × churn (the non-structural / temporal signals)
 *
 * The structural inputs (coupling, co-change) come from the `GraphStore`
 * (`gitsema graph build`); churn is the per-path change frequency from
 * `blob_commits`, computed by `churnByPath()` and passed in so the core
 * scorer stays pure and backend-agnostic.
 */

import type { EdgeType, GraphStore } from '../storage/types.js'
import type { Lens } from '../../cli/lib/lens.js'
import { getActiveSession } from '../db/sqlite.js'

/** Structural edge kinds that count toward call/import coupling. */
export const HOTSPOT_COUPLING_EDGE_TYPES: EdgeType[] = ['calls', 'imports', 'extends', 'implements']

export interface HotspotScore {
  path: string
  nodeKey: string
  /** Final fused architectural-risk score in [0, 1]. */
  risk: number
  /** Which lens(es) contributed to `risk`. */
  lenses: Array<'semantic' | 'structural'>
  /** Raw co-change strength (sum of `co_change` edge weights touching the file). */
  coChange: number
  /** Raw call/import coupling degree (structural edges incident to the file or its symbols). */
  coupling: number
  /** Raw churn (number of commits that touched the file). */
  churn: number
  coChangeNorm: number
  couplingNorm: number
  churnNorm: number
}

export interface HotspotsResult {
  lens: Lens
  hotspots: HotspotScore[]
}

export interface HotspotsOptions {
  lens?: Lens
  topK?: number
  /** Per-path commit count (churn). Paths absent from the map score 0 churn. */
  churnByPath?: Map<string, number>
}

/** Which signals a lens selects for the geometric-mean risk product. */
function signalsForLens(lens: Lens): Array<'coChange' | 'coupling' | 'churn'> {
  switch (lens) {
    case 'structural':
      return ['coupling']
    case 'semantic':
      return ['coChange', 'churn']
    case 'hybrid':
    default:
      return ['coChange', 'coupling', 'churn']
  }
}

export async function computeHotspots(graph: GraphStore, opts: HotspotsOptions = {}): Promise<HotspotsResult> {
  const lens = opts.lens ?? 'hybrid'
  const topK = opts.topK ?? 20
  const churnByPath = opts.churnByPath ?? new Map<string, number>()

  const nodes = await graph.allNodes()
  // node_key → owning file path (file nodes carry their own path; symbol nodes
  // carry the path of the file that defines them).
  const pathByKey = new Map<string, string>()
  const fileNodeByPath = new Map<string, string>()
  for (const n of nodes) {
    if (n.path) pathByKey.set(n.nodeKey, n.path)
    if (n.kind === 'file' && n.path) fileNodeByPath.set(n.path, n.nodeKey)
  }
  if (fileNodeByPath.size === 0) return { lens, hotspots: [] }

  // -- Coupling: structural edges incident to a file or any of its symbols ---
  const coupling = new Map<string, number>()
  const structEdges = await graph.allEdges(HOTSPOT_COUPLING_EDGE_TYPES)
  for (const e of structEdges) {
    const sp = pathByKey.get(e.srcKey)
    const dp = pathByKey.get(e.dstKey)
    if (sp) coupling.set(sp, (coupling.get(sp) ?? 0) + 1)
    if (dp && dp !== sp) coupling.set(dp, (coupling.get(dp) ?? 0) + 1)
  }

  // -- Co-change: sum of co_change edge weights leaving each file -----------
  const coChange = new Map<string, number>()
  const coEdges = await graph.allEdges(['co_change'])
  for (const e of coEdges) {
    const sp = pathByKey.get(e.srcKey) ?? (e.srcKey.startsWith('file:') ? e.srcKey.slice('file:'.length) : undefined)
    if (!sp) continue
    coChange.set(sp, (coChange.get(sp) ?? 0) + (e.observedCount ?? e.weight ?? 1))
  }

  const maxCoupling = Math.max(1, ...coupling.values())
  const maxCoChange = Math.max(1, ...coChange.values())
  const maxChurn = Math.max(1, ...churnByPath.values())
  const signals = signalsForLens(lens)

  const scores: HotspotScore[] = []
  for (const [path, nodeKey] of fileNodeByPath) {
    const rawCoChange = coChange.get(path) ?? 0
    const rawCoupling = coupling.get(path) ?? 0
    const rawChurn = churnByPath.get(path) ?? 0

    const coChangeNorm = rawCoChange / maxCoChange
    const couplingNorm = rawCoupling / maxCoupling
    const churnNorm = rawChurn / maxChurn

    const normByName = { coChange: coChangeNorm, coupling: couplingNorm, churn: churnNorm }
    // Geometric mean over participating signals.
    let product = 1
    for (const s of signals) product *= normByName[s]
    const risk = signals.length === 0 ? 0 : Math.pow(product, 1 / signals.length)

    const lenses: Array<'semantic' | 'structural'> = []
    if (couplingNorm > 0 && signals.includes('coupling')) lenses.push('structural')
    if ((coChangeNorm > 0 || churnNorm > 0) && (signals.includes('coChange') || signals.includes('churn'))) lenses.push('semantic')

    scores.push({
      path,
      nodeKey,
      risk,
      lenses,
      coChange: rawCoChange,
      coupling: rawCoupling,
      churn: rawChurn,
      coChangeNorm,
      couplingNorm,
      churnNorm,
    })
  }

  scores.sort((a, b) => b.risk - a.risk)
  return { lens, hotspots: scores.filter((s) => s.risk > 0).slice(0, topK) }
}

/**
 * Per-path churn (number of distinct commits that touched a blob at each path),
 * derived from `blob_commits` × `paths` — the same change-frequency signal the
 * debt scorer uses. sqlite-only (raw SQL via the active session); other
 * backends return an empty map and the hybrid/semantic lenses degrade to their
 * structural component.
 */
export function churnByPath(): Map<string, number> {
  const { rawDb } = getActiveSession()
  const rows = rawDb.prepare(`
    SELECT p.path AS path, COUNT(DISTINCT bc.commit_hash) AS churn
    FROM paths p
    JOIN blob_commits bc ON bc.blob_hash = p.blob_hash
    GROUP BY p.path
  `).all() as Array<{ path: string; churn: number }>
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.path, r.churn)
  return map
}
