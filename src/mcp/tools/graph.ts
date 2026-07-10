import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTool } from '../registerTool.js'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { callers, callees, neighbors, path as graphPath } from '../../core/graph/traversal.js'
import { computeHotspots, churnByPath } from '../../core/graph/hotspots.js'
import { relate } from '../../core/graph/relate.js'
import { similar } from '../../core/graph/similar.js'
import { unused, UNUSED_EDGE_TYPES } from '../../core/graph/unused.js'
import { findCycles } from '../../core/graph/cycles.js'
import { deps, DEPS_EDGE_TYPES } from '../../core/graph/deps.js'
import { coChange } from '../../core/graph/coChange.js'
import { blastRadius } from '../../core/graph/blastRadius.js'
import { renderBlastRadius } from '../../cli/lib/graphRender.js'
import { parseLens } from '../../cli/lib/lens.js'
import { MAX_GRAPH_DEPTH_REQUEST } from '../../core/storage/types.js'
import type { EdgeType, GraphHit } from '../../core/storage/types.js'
import type { SemanticHit } from '../../core/graph/semanticNeighbors.js'

const EDGE_TYPE_ENUM = z.enum(['contains', 'defines', 'imports', 'calls', 'extends', 'implements', 'references', 'co_change', 'similar_to'])

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

function renderSemanticHits(hits: SemanticHit[]): string {
  if (hits.length === 0) return '  (none)'
  return hits.map((h) => `  ${h.score.toFixed(3)}  ${h.symbolName ?? h.paths[0] ?? '(unknown)'}`).join('\n')
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
      top_k: z.number().int().positive().max(500).optional().default(20).describe('Number of hotspots to return (max 500)'),
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

  registerTool(
    server,
    'graph_path',
    'Shortest typed path between two nodes in the structural graph (Phase 108/147: `gitsema index --graph` + `gitsema graph build`) — "how does A reach B" across imports/calls/extends/implements/references/co_change edges.',
    {
      from: z.string().describe('A symbol qualified name, file path, or literal node key (file:..., symbol:..., external:...)'),
      to: z.string().describe('A symbol qualified name, file path, or literal node key'),
    },
    async ({ from, to }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const result = await graphPath(profile.graph, from, to)

        if (result.from.status !== 'found') {
          return { content: [{ type: 'text', text: renderResolutionError(from, result.from) }] }
        }
        if (result.to.status !== 'found') {
          return { content: [{ type: 'text', text: renderResolutionError(to, result.to) }] }
        }

        const fromNode = result.from.node
        const toNode = result.to.node
        if (!result.path) {
          return { content: [{ type: 'text', text: `No path found from ${fromNode.displayName} to ${toNode.displayName} within the traversal depth limit.` }] }
        }
        if (result.path.hops.length === 0) {
          return { content: [{ type: 'text', text: `${fromNode.displayName} is the same node as ${toNode.displayName}.` }] }
        }
        const segments = [fromNode.displayName]
        for (const hop of result.path.hops) {
          segments.push(hop.reversed ? `<-[${hop.edgeType}]-` : `-[${hop.edgeType}]->`, hop.displayName)
        }
        return { content: [{ type: 'text', text: segments.join(' ') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'graph_relate',
    'Combined structural + semantic view of a symbol/file (Phase 109/147): direct (depth-1) callers/callees via the structural graph, plus semantically similar blobs/symbols. `--lens` selects which signal(s) drive the result.',
    {
      symbol: z.string().describe('A symbol qualified name, file path, or literal node key (file:..., symbol:..., external:...)'),
      lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('hybrid').describe('Which lens(es) to include (default: hybrid)'),
      top_k: z.number().int().positive().max(500).optional().describe('Number of semantic neighbors to return (default 10)'),
    },
    async ({ symbol, lens, top_k }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const resolvedLens = parseLens(lens, 'hybrid')
        const result = await relate(profile.graph, symbol, { lens: resolvedLens, topK: top_k })

        if (result.resolved.status !== 'found') {
          return { content: [{ type: 'text', text: renderResolutionError(symbol, result.resolved) }] }
        }

        const node = result.resolved.node
        const lines = [`Related to ${node.displayName} (${node.nodeKey}) — lens: ${result.lens}`, '']
        if (result.lens !== 'semantic') {
          lines.push('Called by [structural]:', renderHits(result.callers), '', 'Calls [structural]:', renderHits(result.callees), '')
        }
        if (result.lens !== 'structural') {
          lines.push('Semantically similar [semantic]:', result.semanticSupported ? renderSemanticHits(result.similar) : '  (not supported on this storage backend)')
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'graph_similar',
    'Nodes similar to a symbol/file (Phase 109/147): structural similarity ranks by Jaccard overlap of outgoing edge targets ("same call/import shape"); semantic similarity ranks by embedding cosine similarity. `--lens` selects which signal(s) to include.',
    {
      symbol: z.string().describe('A symbol qualified name, file path, or literal node key (file:..., symbol:..., external:...)'),
      lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('hybrid').describe('Which lens(es) to include (default: hybrid)'),
      top_k: z.number().int().positive().max(500).optional().describe('Number of results to return per lens (default 10)'),
    },
    async ({ symbol, lens, top_k }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const resolvedLens = parseLens(lens, 'hybrid')
        const result = await similar(profile.graph, symbol, { lens: resolvedLens, topK: top_k })

        if (result.resolved.status !== 'found') {
          return { content: [{ type: 'text', text: renderResolutionError(symbol, result.resolved) }] }
        }

        const node = result.resolved.node
        const lines = [`Similar to ${node.displayName} (${node.nodeKey}) — lens: ${result.lens}`, '']
        if (result.lens !== 'semantic') {
          lines.push('Structural (same call/import shape):')
          lines.push(result.structural.length === 0 ? '  (none)' : result.structural.map((h) => `  ${h.jaccard.toFixed(3)}  ${h.displayName}  (${h.shared} shared)`).join('\n'))
          lines.push('')
        }
        if (result.lens !== 'structural') {
          lines.push('Semantic:')
          lines.push(result.semanticSupported ? renderSemanticHits(result.semantic) : '  (not supported on this storage backend)')
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'graph_unused',
    'Symbols/files with no inbound `calls`/`imports` edges in the structural graph (Phase 109/147: `gitsema index --graph` + `gitsema graph build`) — the structural complement to `dead_concepts`.',
    {
      edge_types: z.array(EDGE_TYPE_ENUM).optional().describe('Inbound edge types that count as "used" (default: calls, imports)'),
    },
    async ({ edge_types }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const edgeTypes = (edge_types as EdgeType[] | undefined) ?? UNUSED_EDGE_TYPES
        const result = await unused(profile.graph, { edgeTypes })
        if (result.nodes.length === 0) {
          return { content: [{ type: 'text', text: 'No unused symbols or files found (or `gitsema graph build` has not been run).' }] }
        }
        const lines = result.nodes.map((n) => `  [${n.kind}] ${n.displayName}${n.path ? `  (${n.path})` : ''}`)
        return { content: [{ type: 'text', text: `${result.nodes.length} unused node${result.nodes.length === 1 ? '' : 's'} (no inbound calls/imports):\n\n${lines.join('\n')}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'cycles',
    'Detects cycles in the structural graph (Phase 107/147: `gitsema index --graph` + `gitsema graph build`), by default over `imports` edges (import cycles).',
    {
      edge_types: z.array(EDGE_TYPE_ENUM).optional().describe('Edge types to traverse for cycle detection (default: imports)'),
    },
    async ({ edge_types }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const edgeTypes = (edge_types as EdgeType[] | undefined) ?? (['imports'] as EdgeType[])
        const found = await findCycles(profile.graph, edgeTypes)
        if (found.length === 0) {
          return { content: [{ type: 'text', text: `No ${edgeTypes.join('/')} cycles found.` }] }
        }
        const lines = found.map((c) => `  ${c.displayNames.join(' -> ')}`)
        return { content: [{ type: 'text', text: `Found ${found.length} ${edgeTypes.join('/')} cycle(s):\n\n${lines.join('\n')}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'deps',
    'Dependency (or, with reverse=true, dependent) closure of a file or symbol (Phase 107/147: `gitsema index --graph` + `gitsema graph build`) — BFS over imports/calls/extends/implements edges.',
    {
      identifier: z.string().describe('A symbol qualified name, file path, or literal node key (file:..., symbol:..., external:...)'),
      reverse: z.boolean().optional().describe('Walk dependents (inbound edges) instead of dependencies (outbound edges)'),
      depth: z.number().int().positive().max(MAX_GRAPH_DEPTH_REQUEST).optional().describe(`Traversal depth (default: unlimited, max ${MAX_GRAPH_DEPTH_REQUEST})`),
      edge_types: z.array(EDGE_TYPE_ENUM).optional().describe('Edge types to traverse (default: imports, calls, extends, implements)'),
    },
    async ({ identifier, reverse, depth, edge_types }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const edgeTypes = (edge_types as EdgeType[] | undefined) ?? DEPS_EDGE_TYPES
        const result = await deps(profile.graph, identifier, { reverse, depth, edgeTypes })

        if (result.resolved.status !== 'found') {
          return { content: [{ type: 'text', text: renderResolutionError(identifier, result.resolved) }] }
        }

        const node = result.resolved.node
        const label = reverse ? 'Dependents of' : 'Dependencies of'
        if (result.hits.length === 0) {
          return { content: [{ type: 'text', text: `${label} ${node.displayName} (${node.nodeKey}):\n\n  (none)` }] }
        }
        const lines = result.hits.map((h) => `  [${h.edgeType}] ${h.displayName}  (depth ${h.depth})`)
        return { content: [{ type: 'text', text: `${label} ${node.displayName} (${node.nodeKey}):\n\n${lines.join('\n')}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'co_change',
    'Files that historically change together with a given path (Phase 107/147), materialized as `co_change` edges by `gitsema graph build` from `blob_commits` history.',
    {
      path: z.string().describe('File path'),
      top: z.number().int().positive().max(500).optional().default(10).describe('Number of co-changing files to return (default 10)'),
    },
    async ({ path, top }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const result = await coChange(profile.graph, path, top)
        if (!result.found) {
          return { content: [{ type: 'text', text: `No graph node for "${path}". Run \`gitsema index --graph\` then \`gitsema graph build\` first.` }] }
        }
        if (result.hits.length === 0) {
          return { content: [{ type: 'text', text: `No co-change history for ${path}.` }] }
        }
        const lines = result.hits.map((h) => `  ${h.path}  (${h.count} commits)`)
        return { content: [{ type: 'text', text: `Files that change together with ${path}:\n\n${lines.join('\n')}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'blast_radius',
    '"What breaks if I touch this" (Phase 109/147): structural dependents (who references this node, transitively) and/or semantically similar blobs, selected by `--lens`. The graph-aware upgrade to `impact`\'s semantic-only analysis.',
    {
      symbol: z.string().describe('A symbol qualified name, file path, or literal node key (file:..., symbol:..., external:...)'),
      lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('hybrid').describe('Which lens(es) to include (default: hybrid)'),
      depth: z.number().int().positive().max(MAX_GRAPH_DEPTH_REQUEST).optional().describe('Structural traversal depth (default: unlimited within MAX_GRAPH_TRAVERSAL_DEPTH)'),
      top_k: z.number().int().positive().max(500).optional().describe('Number of semantic neighbors to return (default 10)'),
    },
    async ({ symbol, lens, depth, top_k }) => {
      try {
        const profile = getCachedStorageProfile(process.cwd())
        const resolvedLens = parseLens(lens, 'hybrid')
        const result = await blastRadius(profile.graph, symbol, { lens: resolvedLens, depth, topK: top_k })

        if (result.resolved.status !== 'found') {
          return { content: [{ type: 'text', text: renderResolutionError(symbol, result.resolved) }] }
        }

        return { content: [{ type: 'text', text: renderBlastRadius(result, result.resolved.node) }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )
}
