/**
 * Phase 114 (LSP & MCP fleshout §5 / "Phase C") — structural navigation for
 * the LSP server, backed by the Phase 106/107 knowledge-graph tables
 * (`structural_refs`/`graph_nodes`/`edges`). Reuses `src/core/graph/traversal.ts`
 * and `resolveNode.ts` directly — no new graph-query SQL lives here.
 */

import { getActiveSession } from '../db/sqlite.js'
import { SqliteGraphStore } from '../storage/sqlite/profile.js'
import { resolveNode } from '../graph/resolveNode.js'
import { callers, callees } from '../graph/traversal.js'
import type { GraphHit, GraphNodeRecord, GraphStore } from '../storage/types.js'

export interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export interface StructuralLocation {
  uri: string
  range: LspRange
  symbolName: string
  symbolKind: string
}

export interface CallHierarchyItem {
  name: string
  kind: number
  uri: string
  range: LspRange
  selectionRange: LspRange
  /** Carries the resolved graph node key, so incomingCalls/outgoingCalls can be invoked without a full prepareCallHierarchy round-trip. */
  data: string
}

export interface CallHierarchyIncomingCall {
  from: CallHierarchyItem
  fromRanges: LspRange[]
}

export interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem
  fromRanges: LspRange[]
}

/** Maps `symbols.symbol_kind` values to LSP `SymbolKind` numbers (shared with `documentSymbol`). */
export const LSP_SYMBOL_KIND: Record<string, number> = {
  function: 12, method: 6, class: 5, struct: 23, enum: 10,
  trait: 11, impl: 14, other: 13,
}

/** A fresh `GraphStore` bound to the currently-active DB session (mirrors the `gitsema graph` CLI's sqlite-only assumption — Postgres/Qdrant callers should check `profile.backend` upstream). */
export function activeGraphStore(): GraphStore {
  return new SqliteGraphStore()
}

/** True once `gitsema graph build` has populated the structural graph (Phase 107) for the active DB. Used to gate structural-first lookups — empty/unbuilt graphs always fall back to semantic search. */
export async function isGraphBuilt(graph: GraphStore): Promise<boolean> {
  try {
    return (await graph.countNodes()) > 0
  } catch {
    return false
  }
}

function rangeForSymbolRow(row: { start_line: number; end_line: number } | undefined): LspRange {
  const start = row ? Math.max(0, row.start_line - 1) : 0
  const end = row ? Math.max(0, row.end_line - 1) : 0
  return { start: { line: start, character: 0 }, end: { line: end, character: 0 } }
}

/** Looks up a symbol node's `(start_line, end_line, symbol_kind)` from `symbols`, by `(qualified_name, blob_hash)` — the same identity Phase 105/107 use to build the node. */
function symbolRowForNode(node: GraphNodeRecord): { start_line: number; end_line: number; symbol_kind: string } | undefined {
  if (node.kind === 'file' || node.kind === 'external' || !node.currentBlobHash) return undefined
  const { rawDb } = getActiveSession()
  return rawDb.prepare(
    `SELECT start_line, end_line, symbol_kind FROM symbols WHERE qualified_name = ? AND blob_hash = ? LIMIT 1`,
  ).get(node.displayName, node.currentBlobHash) as { start_line: number; end_line: number; symbol_kind: string } | undefined
}

function locationForNode(node: GraphNodeRecord): StructuralLocation | null {
  if (!node.path) return null
  const symRow = symbolRowForNode(node)
  return {
    uri: `file://${node.path}`,
    range: rangeForSymbolRow(symRow),
    symbolName: node.displayName,
    symbolKind: symRow?.symbol_kind ?? node.kind,
  }
}

/**
 * Structural-first "go to definition": resolves `identifier` to an exact
 * graph node (file path or symbol qualified name) and returns its precise
 * location. Returns `[]` (not an error) when the graph has no match for this
 * identifier — callers should fall back to semantic search per spec §5.3.
 */
export async function structuralDefinition(graph: GraphStore, identifier: string): Promise<StructuralLocation[]> {
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') return []
  const loc = locationForNode(resolved.node)
  return loc ? [loc] : []
}

/**
 * Structural-first "find references": all nodes with an incoming structural
 * edge (`calls`/`references`/`imports`/`extends`/`implements`) into
 * `identifier`'s resolved node. Returns `[]` when unresolved per §5.3.
 */
export async function structuralReferences(graph: GraphStore, identifier: string): Promise<StructuralLocation[]> {
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') return []
  const edges = await graph.edgesFor(resolved.node.nodeKey, {
    edgeTypes: ['calls', 'references', 'imports', 'extends', 'implements'],
    direction: 'in',
  })
  const locations: StructuralLocation[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    const srcNode = await graph.getNode(edge.srcKey)
    if (!srcNode) continue
    const loc = locationForNode(srcNode)
    if (!loc) continue
    const key = `${loc.uri}:${loc.range.start.line}`
    if (seen.has(key)) continue
    seen.add(key)
    locations.push(loc)
  }
  return locations
}

function callHierarchyItem(node: GraphNodeRecord): CallHierarchyItem | null {
  if (!node.path) return null
  const symRow = symbolRowForNode(node)
  const range = rangeForSymbolRow(symRow)
  return {
    name: node.displayName,
    kind: LSP_SYMBOL_KIND[symRow?.symbol_kind ?? ''] ?? 13,
    uri: `file://${node.path}`,
    range,
    selectionRange: range,
    data: node.nodeKey,
  }
}

async function hitsToItems(graph: GraphStore, hits: GraphHit[]): Promise<CallHierarchyItem[]> {
  const items: CallHierarchyItem[] = []
  for (const hit of hits) {
    if (!hit.nodeKey.startsWith('symbol:')) continue
    const node = await graph.getNode(hit.nodeKey)
    const item = node ? callHierarchyItem(node) : null
    if (item) items.push(item)
  }
  return items
}

/** `textDocument/prepareCallHierarchy` — resolves an identifier to a `CallHierarchyItem`. */
export async function prepareCallHierarchy(graph: GraphStore, identifier: string): Promise<CallHierarchyItem[]> {
  const resolved = await resolveNode(graph, identifier)
  if (resolved.status !== 'found') return []
  const item = callHierarchyItem(resolved.node)
  return item ? [item] : []
}

/** `callHierarchy/incomingCalls` — direct (depth-1) callers of `identifier`/`item.data`, via the `calls` edge type. */
export async function incomingCalls(graph: GraphStore, identifier: string): Promise<CallHierarchyIncomingCall[]> {
  const result = await callers(graph, identifier, 1)
  if (result.resolved.status !== 'found') return []
  const items = await hitsToItems(graph, result.hits)
  return items.map((from) => ({ from, fromRanges: [from.range] }))
}

/** `callHierarchy/outgoingCalls` — direct (depth-1) callees of `identifier`/`item.data`, via the `calls` edge type. */
export async function outgoingCalls(graph: GraphStore, identifier: string): Promise<CallHierarchyOutgoingCall[]> {
  const result = await callees(graph, identifier, 1)
  if (result.resolved.status !== 'found') return []
  const items = await hitsToItems(graph, result.hits)
  return items.map((to) => ({ to, fromRanges: [to.range] }))
}
