/**
 * HTTP routes for the structural knowledge graph (Phase 110/111, extended
 * Phase 147).
 *
 * Routes (under /api/v1/graph/):
 *   POST /hotspots     — architectural risk = co-change × call-coupling × churn
 *   POST /callers       — reverse `calls` traversal (who calls a symbol)
 *   POST /callees       — forward `calls` traversal (what a symbol calls)
 *   POST /neighbors     — typed neighborhood of a node (any edge kinds)
 *   POST /path          — shortest typed path between two nodes
 *   POST /relate        — structural callers/callees + semantic neighbors
 *   POST /similar       — structural (Jaccard shape) + semantic similarity
 *   POST /unused        — nodes with no inbound calls/imports edges
 *   POST /cycles        — cycle detection over typed edges (default: imports)
 *   POST /deps          — dependency/dependent closure (imports/calls/extends/implements)
 *   POST /co-change     — files that historically change together with a path
 *   POST /blast-radius  — structural dependents + semantic neighbors ("what breaks if I touch this")
 *
 * `graph build` (Phase 107's truncate-and-rebuild of `graph_nodes`/`edges`)
 * is intentionally **not** exposed here — see the note above `graphRouter()`.
 */

import { Router } from 'express'
import { z } from 'zod'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { computeHotspots, churnByPath } from '../../core/graph/hotspots.js'
import { callers, callees, path as graphPath, neighbors } from '../../core/graph/traversal.js'
import { relate } from '../../core/graph/relate.js'
import { similar } from '../../core/graph/similar.js'
import { unused, UNUSED_EDGE_TYPES } from '../../core/graph/unused.js'
import { findCycles } from '../../core/graph/cycles.js'
import { deps, DEPS_EDGE_TYPES } from '../../core/graph/deps.js'
import { coChange } from '../../core/graph/coChange.js'
import { blastRadius } from '../../core/graph/blastRadius.js'
import { parseLens } from '../../cli/lib/lens.js'
import type { EdgeType } from '../../core/storage/types.js'

const HotspotsBodySchema = z.object({
  lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('hybrid'),
  topK: z.number().int().positive().max(500).optional().default(20),
  // Accepted for CLI flag-surface parity (`--weight-structural`, via
  // `addLensOption`) but currently a no-op: `computeHotspots`'s risk score is
  // an unweighted geometric mean over the active lens's signals with no
  // weighting hook, same as the CLI's own `hotspotsCommand` (Phase 139).
  weightStructural: z.number().optional(),
})

const EdgeTypeSchema = z.enum(['contains', 'defines', 'imports', 'calls', 'extends', 'implements', 'references', 'co_change', 'similar_to'])

const TraversalBodySchema = z.object({
  symbol: z.string().min(1),
  depth: z.number().int().min(1).max(3).optional(),
})

const PathBodySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
})

const NeighborsBodySchema = z.object({
  node: z.string().min(1),
  edgeTypes: z.array(EdgeTypeSchema).optional(),
  direction: z.enum(['out', 'in', 'both']).optional().default('both'),
  depth: z.number().int().min(1).max(3).optional(),
})

const LensQueryBodySchema = z.object({
  symbol: z.string().min(1),
  lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('hybrid'),
  topK: z.number().int().positive().optional(),
})

const UnusedBodySchema = z.object({
  edgeTypes: z.array(EdgeTypeSchema).optional(),
})

const CyclesBodySchema = z.object({
  edgeTypes: z.array(EdgeTypeSchema).optional(),
})

const DepsBodySchema = z.object({
  identifier: z.string().min(1),
  reverse: z.boolean().optional(),
  depth: z.number().int().positive().optional(),
  edgeTypes: z.array(EdgeTypeSchema).optional(),
})

const CoChangeBodySchema = z.object({
  path: z.string().min(1),
  top: z.number().int().positive().optional().default(10),
})

const BlastRadiusBodySchema = z.object({
  symbol: z.string().min(1),
  lens: z.enum(['semantic', 'structural', 'hybrid']).optional().default('hybrid'),
  depth: z.number().int().positive().optional(),
  topK: z.number().int().positive().optional(),
})

/**
 * `graph build` (Phase 107) truncates and rebuilds `graph_nodes`/`edges` from
 * `structural_refs`/`symbols`/`blob_commits` — a mutating, full-table-rewrite
 * index-maintenance operation, not a query. None of gitsema's other
 * maintenance commands with the same shape (`index vacuum`, `index gc`,
 * `index rebuild-fts`, `index update-modules`, `index clear-model`,
 * `index build-vss`) have an HTTP route either — they're CLI/local-only by
 * existing convention. `graph build` follows that precedent rather than
 * becoming the first mutating maintenance op exposed over HTTP (Phase 147).
 */
export function graphRouter(): Router {
  const router = Router()

  router.post('/hotspots', async (req, res) => {
    const parsed = HotspotsBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const churn = profile.backend === 'sqlite' ? churnByPath() : new Map<string, number>()
      const result = await computeHotspots(profile.graph, {
        lens: parseLens(parsed.data.lens, 'hybrid'),
        topK: parsed.data.topK,
        churnByPath: churn,
      })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/callers', async (req, res) => {
    const parsed = TraversalBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const result = await callers(profile.graph, parsed.data.symbol, parsed.data.depth)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/callees', async (req, res) => {
    const parsed = TraversalBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const result = await callees(profile.graph, parsed.data.symbol, parsed.data.depth)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/neighbors', async (req, res) => {
    const parsed = NeighborsBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const { node, edgeTypes, direction, depth } = parsed.data
      const result = await neighbors(profile.graph, node, { edgeTypes: edgeTypes as EdgeType[] | undefined, direction, depth })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/path', async (req, res) => {
    const parsed = PathBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const result = await graphPath(profile.graph, parsed.data.from, parsed.data.to)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/relate', async (req, res) => {
    const parsed = LensQueryBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const { symbol, lens, topK } = parsed.data
      const result = await relate(profile.graph, symbol, { lens: parseLens(lens, 'hybrid'), topK })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/similar', async (req, res) => {
    const parsed = LensQueryBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const { symbol, lens, topK } = parsed.data
      const result = await similar(profile.graph, symbol, { lens: parseLens(lens, 'hybrid'), topK })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/unused', async (req, res) => {
    const parsed = UnusedBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const edgeTypes = (parsed.data.edgeTypes as EdgeType[] | undefined) ?? UNUSED_EDGE_TYPES
      const result = await unused(profile.graph, { edgeTypes })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/cycles', async (req, res) => {
    const parsed = CyclesBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const edgeTypes = (parsed.data.edgeTypes as EdgeType[] | undefined) ?? (['imports'] as EdgeType[])
      const cycles = await findCycles(profile.graph, edgeTypes)
      res.json({ edgeTypes, cycles })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/deps', async (req, res) => {
    const parsed = DepsBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const { identifier, reverse, depth, edgeTypes } = parsed.data
      const result = await deps(profile.graph, identifier, {
        reverse,
        depth,
        edgeTypes: (edgeTypes as EdgeType[] | undefined) ?? DEPS_EDGE_TYPES,
      })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/co-change', async (req, res) => {
    const parsed = CoChangeBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const result = await coChange(profile.graph, parsed.data.path, parsed.data.top)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/blast-radius', async (req, res) => {
    const parsed = BlastRadiusBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
      return
    }
    try {
      const profile = getCachedStorageProfile(process.cwd())
      const { symbol, lens, depth, topK } = parsed.data
      const result = await blastRadius(profile.graph, symbol, { lens: parseLens(lens, 'hybrid'), depth, topK })
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
