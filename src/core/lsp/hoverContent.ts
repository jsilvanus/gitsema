/**
 * Phase 115 (LSP & MCP fleshout §6.1 — "Phase D") — hover Markdown builder.
 * Keeps `server.ts`'s JSON-RPC plumbing free of analysis logic: this module
 * joins the semantic results `textDocument/hover` already computed with
 * temporal (`blob_commits`/`commits`), risk (`analysisCache.ts`), and
 * structural (Phase 114 `structuralNav.ts`/`traversal.ts`) sections. Each
 * section is independently optional — omitted, not erroring the whole hover,
 * when its data source is unavailable (no commits, no cache yet, no graph).
 *
 * Section order — cheapest/most-universal first, most graph-dependent last —
 * per the spec's "Semantic → Temporal → Risk & Quality → Structure" ordering.
 */

import { getActiveSession } from '../db/sqlite.js'
import { getAnalysisCache } from './analysisCache.js'
import { callers, callees } from '../graph/traversal.js'
import { activeGraphStore, isGraphBuilt } from './structuralNav.js'

export interface HoverContext {
  /** The raw query/identifier being hovered. */
  query: string
  /** Pre-rendered `- \`path\` — similarity: 0.812` lines from the existing semantic search. */
  semanticLines: string[]
  /** Resolved blob hash for the symbol's defining file, if known (enables Temporal + security risk). */
  blobHash?: string
  /** Resolved file path for the symbol, if known (enables debt/hotspot risk). */
  path?: string
}

function temporalSection(blobHash: string | undefined): string | undefined {
  if (!blobHash) return undefined
  const { rawDb } = getActiveSession()
  const row = rawDb.prepare(`
    SELECT c.author_name AS author, MAX(c.timestamp) AS lastTouched, COUNT(DISTINCT bc.commit_hash) AS changeFreq
    FROM blob_commits bc
    JOIN commits c ON c.commit_hash = bc.commit_hash
    WHERE bc.blob_hash = ?
    GROUP BY c.author_name
    ORDER BY lastTouched DESC
    LIMIT 1
  `).get(blobHash) as { author: string | null; lastTouched: number; changeFreq: number } | undefined
  if (!row) return undefined
  const date = new Date(row.lastTouched * 1000).toISOString().slice(0, 10)
  const author = row.author ?? 'unknown'
  return `**Temporal**\n\nLast touched by ${author} on ${date} · changed ${row.changeFreq}× total`
}

function riskSection(path: string | undefined, blobHash: string | undefined): string | undefined {
  const cache = getAnalysisCache()
  if (!cache) return undefined
  const lines: string[] = []
  if (path) {
    const debt = cache.debtByPath.get(path)
    if (debt) lines.push(`Debt score: ${debt.debtScore.toFixed(2)} (isolation ${debt.isolationScore.toFixed(2)}, age ${debt.ageScore.toFixed(2)})`)
    const hotspot = cache.hotspotByPath.get(path)
    if (hotspot) lines.push(`Hotspot risk: ${hotspot.risk.toFixed(2)}`)
  }
  if (blobHash) {
    const secCount = cache.securityCountByBlob.get(blobHash)
    if (secCount) lines.push(`Security pattern matches: ${secCount} (similarity-based, not confirmed CVEs)`)
  }
  if (lines.length === 0) return undefined
  return `**Risk & quality**\n\n${lines.map((l) => `- ${l}`).join('\n')}`
}

async function structureSection(query: string): Promise<string | undefined> {
  const graph = activeGraphStore()
  if (!(await isGraphBuilt(graph))) return undefined
  const inResult = await callers(graph, query, 1)
  if (inResult.resolved.status !== 'found') return undefined
  const outResult = await callees(graph, query, 1)
  const lines = [`Callers: ${inResult.hits.length}`, `Callees: ${outResult.hits.length}`]
  return `**Structure**\n\n${lines.map((l) => `- ${l}`).join('\n')}`
}

export async function buildHoverMarkdown(ctx: HoverContext): Promise<string> {
  const sections: string[] = [`**Semantic matches for \`${ctx.query}\`**\n\n${ctx.semanticLines.join('\n')}`]

  const temporal = temporalSection(ctx.blobHash)
  if (temporal) sections.push(temporal)

  const risk = riskSection(ctx.path, ctx.blobHash)
  if (risk) sections.push(risk)

  const structure = await structureSection(ctx.query)
  if (structure) sections.push(structure)

  return sections.join('\n\n---\n\n')
}
