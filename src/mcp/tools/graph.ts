import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTool } from '../registerTool.js'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { callers, callees, neighbors } from '../../core/graph/traversal.js'
import { computeHotspots, churnByPath } from '../../core/graph/hotspots.js'
import { parseLens } from '../../cli/lib/lens.js'
import type { EdgeType, GraphHit } from '../../core/storage/types.js'

function renderResolutionError(label: string, resolved: { status: string; candidates?: Array<{ nodeKey: string }> }): string {
  if (resolved.status === 'not-found') {
    return `No graph node found for "${label}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.`
  }
  const candidates = (resolved.candidates ?? []).map((c) => `  ${c.nodeKey}`).join('\n')
  return `"${label}" is ambiguous — matches multiple symbols:\n${candidates}`
}

function renderHits(hits: GraphHit[]): string {
  if (hits.length === 0) return '  (none)'
  return hits.map((h) => `  ${h.edgeType ? `[${h.edgeType}] ` : ''}${h.displayName}  (depth ${h.depth})`).join('\n')
}

/**
 * Phase 108 (knowledge-graph §6/§8) MCP tools, exposing the `GraphStore`
 * traversal primitives: `call_graph` (callers/callees over `calls` edges)
 * and `graph_neighbors` (typed neighborhood, any edge kinds).
 */
export function registerGraphTools(server: McpServer) {
  registerTool(
    server,
    'call_graph',
    'Structural call-graph traversal: who calls (or is called by) a symbol, via the Phase 107/108 structural graph (`gitsema index --graph` + `gitsema graph build`). Reverse `calls` traversal (direction=callers) finds callers; forward (direction=callees) finds callees.',
    {
      symbol: z.string().describe('A symbol qualified name, file path, or literal node key (file:..., symbol:..., external:...)'),
      direction: z.enum(['callers', 'callees']).optional().default('callers').describe('Traverse reverse (callers) or forward (callees) `calls` edges'),
      depth: z.number().int().min(1).max(3).optional().describe('Traversal depth (default and max: 3)'),
    },
    async ({ symbol, direction, depth }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const result = direction === 'callees'
          ? await callees(profile.graph, symbol, depth)
          : await callers(profile.graph, symbol, depth)

        if (result.resolved.status !== 'found') {
          return { content: [{ type: 'text', text: renderResolutionError(symbol, result.resolved) }] }
        }

        const node = result.resolved.node
        const label = direction === 'callees' ? 'Callees of' : 'Callers of'
        return { content: [{ type: 'text', text: `${label} ${node.displayName} (${node.nodeKey}):\n\n${renderHits(result.hits)}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'graph_neighbors',
    'Typed neighborhood of a node in the structural graph (Phase 107/108: `gitsema index --graph` + `gitsema graph build`). Returns nodes connected by the given edge types (default: all) in the given direction.',
    {
      node: z.string().describe('A symbol qualified name, file path, or literal node key (file:..., symbol:..., external:...)'),
      edge_types: z.array(z.enum(['contains', 'defines', 'imports', 'calls', 'extends', 'implements', 'references', 'co_change', 'similar_to']))
        .optional()
        .describe('Edge types to traverse (default: all)'),
      direction: z.enum(['out', 'in', 'both']).optional().default('both').describe("Edge direction relative to 'node'"),
      depth: z.number().int().min(1).max(3).optional().describe('Traversal depth (default 1, max 3)'),
    },
    async ({ node, edge_types, direction, depth }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const result = await neighbors(profile.graph, node, {
          edgeTypes: edge_types as EdgeType[] | undefined,
          direction,
          depth,
        })

        if (result.resolved.status !== 'found') {
          return { content: [{ type: 'text', text: renderResolutionError(node, result.resolved) }] }
        }

        const resolvedNode = result.resolved.node
        return { content: [{ type: 'text', text: `Neighbors of ${resolvedNode.displayName} (${resolvedNode.nodeKey}):\n\n${renderHits(result.hits)}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'hotspots',
    'Architectural risk ranking (Phase 110): risk = co-change (temporal) × call-coupling (structural) × churn, over the structural graph (`gitsema index --graph` + `gitsema graph build`). Default lens `hybrid` fuses all three signals; `structural` ranks by coupling only; `semantic` by co-change × churn.',
    {
      lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('hybrid').describe('Which lens(es) drive the risk score (default: hybrid)'),
      top_k: z.number().int().positive().optional().default(20).describe('Number of hotspots to return'),
    },
    async ({ lens, top_k }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const churn = profile.backend === 'sqlite' ? churnByPath() : new Map<string, number>()
        const result = await computeHotspots(profile.graph, { lens: parseLens(lens, 'hybrid'), topK: top_k, churnByPath: churn })
        if (result.hotspots.length === 0) {
          return { content: [{ type: 'text', text: 'No hotspots found. Run `gitsema index --graph` then `gitsema graph build` first.' }] }
        }
        const lines = result.hotspots.map((h, i) => {
          const label = h.lenses.length > 0 ? ` [${h.lenses.join('+')}]` : ''
          return `${String(i + 1).padStart(2)}. ${h.risk.toFixed(3)}  ${h.path}${label}  (co-change=${h.coChange} coupling=${h.coupling} churn=${h.churn})`
        })
        return { content: [{ type: 'text', text: `Architectural hotspots — lens: ${result.lens}\n\n${lines.join('\n')}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )
}
