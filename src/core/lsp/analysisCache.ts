/**
 * Phase 115 (LSP & MCP fleshout §6.2 — "Phase D") — background-refreshed
 * analysis cache backing LSP diagnostics, code lens, and hover risk sections.
 *
 * Debt scoring, hotspot scoring, and security pattern scanning all scan
 * substantial history/the whole codebase — per §6.2 they must never run
 * synchronously inside a hover/codeLens *request*. This module computes them
 * once on a background timer and serves cached lookups by path/blobHash.
 * Reuses `scoreDebt`/`computeHotspots`/`scanForVulnerabilities` directly —
 * no scoring logic is duplicated here.
 */

import type { getActiveSession } from '../db/sqlite.js'
import { scoreDebt, type DebtResult } from '../search/debtScoring.js'
import { scanForVulnerabilities } from '../search/securityScan.js'
import { computeHotspots, churnByPath, type HotspotScore } from '../graph/hotspots.js'
import { activeGraphStore, isGraphBuilt } from './structuralNav.js'
import type { EmbeddingProvider } from '../embedding/provider.js'

export interface AnalysisCache {
  computedAt: number
  debtByPath: Map<string, DebtResult>
  hotspotByPath: Map<string, HotspotScore>
  securityCountByBlob: Map<string, number>
}

let cache: AnalysisCache | null = null

/** The most recently computed cache, or `null` if no refresh has completed yet. */
export function getAnalysisCache(): AnalysisCache | null {
  return cache
}

/** Test/diagnostics-loop hook to reset cache state between runs. */
export function clearAnalysisCache(): void {
  cache = null
}

/**
 * Recomputes debt/hotspot/security signals for the whole repo and replaces
 * the cache. Each signal is independently best-effort — a failure in one
 * (e.g. no graph built, no embedding provider reachable) never blocks the
 * others, matching the hover/diagnostics graceful-degradation contract.
 */
export async function refreshAnalysisCache(
  dbSession: ReturnType<typeof getActiveSession>,
  provider: EmbeddingProvider,
): Promise<AnalysisCache> {
  const debtByPath = new Map<string, DebtResult>()
  try {
    const debtResults = await scoreDebt(dbSession, provider, { top: Number.MAX_SAFE_INTEGER })
    for (const r of debtResults) {
      for (const p of r.paths) debtByPath.set(p, r)
    }
  } catch {
    // no embeddings indexed yet, or provider unreachable — degrade gracefully
  }

  const hotspotByPath = new Map<string, HotspotScore>()
  try {
    const graph = activeGraphStore()
    if (await isGraphBuilt(graph)) {
      const churn = churnByPath()
      const { hotspots } = await computeHotspots(graph, { topK: Number.MAX_SAFE_INTEGER, churnByPath: churn })
      for (const h of hotspots) hotspotByPath.set(h.path, h)
    }
  } catch {
    // no graph built — degrade gracefully
  }

  const securityCountByBlob = new Map<string, number>()
  try {
    const findings = await scanForVulnerabilities(dbSession, provider, { top: 10 })
    for (const f of findings) {
      securityCountByBlob.set(f.blobHash, (securityCountByBlob.get(f.blobHash) ?? 0) + 1)
    }
  } catch {
    // provider unreachable — degrade gracefully
  }

  cache = { computedAt: Date.now(), debtByPath, hotspotByPath, securityCountByBlob }
  return cache
}

/** LSP `DiagnosticSeverity` numbers (1=Error, 2=Warning, 3=Information, 4=Hint). */
export const DIAGNOSTIC_SEVERITY = { warning: 2, information: 3 } as const

const DEBT_DIAGNOSTIC_THRESHOLD = 0.7
const HOTSPOT_DIAGNOSTIC_THRESHOLD = 0.6

export interface DiagnosticItem {
  severity: number
  message: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

const ZERO_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

/**
 * Flags high-debt and high-hotspot-risk files from the current cache.
 * Returns an empty map (no diagnostics, not an error) when the cache hasn't
 * been populated yet. Thresholds are intentionally conservative for v1 —
 * see the "false positive rate" design note in the spec (§6.4) for why this
 * starts opt-in behind `--diagnostics` rather than promoting to default-on.
 */
export function computeDiagnosticsFromCache(): Map<string, DiagnosticItem[]> {
  const byPath = new Map<string, DiagnosticItem[]>()
  if (!cache) return byPath

  const push = (path: string, item: DiagnosticItem) => {
    const list = byPath.get(path) ?? []
    list.push(item)
    byPath.set(path, list)
  }

  for (const [path, debt] of cache.debtByPath) {
    if (debt.debtScore >= DEBT_DIAGNOSTIC_THRESHOLD) {
      push(path, {
        severity: DIAGNOSTIC_SEVERITY.warning,
        message: `High technical debt (score ${debt.debtScore.toFixed(2)}): isolated, aging, and frequently changed`,
        range: ZERO_RANGE,
      })
    }
  }
  for (const [path, hotspot] of cache.hotspotByPath) {
    if (hotspot.risk >= HOTSPOT_DIAGNOSTIC_THRESHOLD) {
      push(path, {
        severity: DIAGNOSTIC_SEVERITY.information,
        message: `High hotspot risk (score ${hotspot.risk.toFixed(2)}): heavily coupled and frequently co-changed`,
        range: ZERO_RANGE,
      })
    }
  }
  return byPath
}

/**
 * Starts the background refresh timer (default every 5 minutes per §6.2),
 * calling `onRefresh` with the freshly computed diagnostics after each cycle
 * so the caller can push `textDocument/publishDiagnostics` notifications.
 * Runs one refresh immediately so the cache isn't empty for the server's
 * whole first interval.
 */
export function startBackgroundRefresh(
  dbSession: ReturnType<typeof getActiveSession>,
  provider: EmbeddingProvider,
  intervalMs: number,
  onRefresh: (diagnosticsByPath: Map<string, DiagnosticItem[]>) => void,
): ReturnType<typeof setInterval> {
  const run = async () => {
    try {
      await refreshAnalysisCache(dbSession, provider)
      onRefresh(computeDiagnosticsFromCache())
    } catch {
      // never let a refresh failure kill the timer
    }
  }
  void run()
  return setInterval(run, intervalMs)
}

export function stopBackgroundRefresh(handle: ReturnType<typeof setInterval>): void {
  clearInterval(handle)
}
