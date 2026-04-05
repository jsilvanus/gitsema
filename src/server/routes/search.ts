import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import type { Embedding } from '../../core/models/types.js'
import { vectorSearch, mergeSearchResults } from '../../core/search/vectorSearch.js'
import { hybridSearch } from '../../core/search/hybridSearch.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { renderResults, renderFirstSeenResults, groupResults } from '../../core/search/ranking.js'
import type { GroupMode } from '../../core/search/ranking.js'

const SearchBodySchema = z.object({
  query: z.string().min(1),
  top: z.number().int().positive().optional().default(10),
  recent: z.boolean().optional().default(false),
  alpha: z.number().min(0).max(1).optional().default(0.8),
  before: z.string().optional(),
  after: z.string().optional(),
  weightVector: z.number().nonnegative().optional(),
  weightRecency: z.number().nonnegative().optional(),
  weightPath: z.number().nonnegative().optional(),
  group: z.enum(['file', 'module', 'commit']).optional(),
  chunks: z.boolean().optional().default(false),
  hybrid: z.boolean().optional().default(false),
  bm25Weight: z.number().min(0).max(1).optional(),
  // rendered=true returns human-readable string; false (default) returns JSON array
  rendered: z.boolean().optional().default(false),
})

const FirstSeenBodySchema = z.object({
  query: z.string().min(1),
  top: z.number().int().positive().optional().default(10),
  rendered: z.boolean().optional().default(false),
})

export interface SearchRouterDeps {
  textProvider: EmbeddingProvider
  codeProvider?: EmbeddingProvider
}

export function searchRouter(deps: SearchRouterDeps): Router {
  const { textProvider, codeProvider } = deps
  const router = Router()

  router.post('/', async (req, res) => {
    const parsed = SearchBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    const opts = parsed.data

    let before: number | undefined
    let after: number | undefined
    try {
      if (opts.before) before = parseDateArg(opts.before)
      if (opts.after) after = parseDateArg(opts.after)
    } catch (err) {
      res.status(400).json({ error: `Date parse error: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    let textEmbedding: Embedding
    try {
      textEmbedding = await textProvider.embed(opts.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    const searchOpts = {
      topK: opts.top,
      recent: opts.recent,
      alpha: opts.alpha,
      before,
      after,
      weightVector: opts.weightVector,
      weightRecency: opts.weightRecency,
      weightPath: opts.weightPath,
      query: opts.query,
      searchChunks: opts.chunks,
    }

    let results
    if (opts.hybrid) {
      results = hybridSearch(opts.query, textEmbedding, { ...searchOpts, bm25Weight: opts.bm25Weight })
    } else if (codeProvider) {
      let codeEmbedding: Embedding
      try {
        codeEmbedding = await codeProvider.embed(opts.query)
      } catch (err) {
        res.status(502).json({ error: `Code embedding failed: ${err instanceof Error ? err.message : String(err)}` })
        return
      }
      const textModel = textProvider.model
      const codeModel = codeProvider.model
      const textResults = vectorSearch(textEmbedding, { ...searchOpts, model: textModel })
      const codeResults = vectorSearch(codeEmbedding, { ...searchOpts, model: codeModel })
      results = mergeSearchResults(textResults, codeResults, opts.top)
    } else {
      results = vectorSearch(textEmbedding, searchOpts)
    }

    if (opts.group) {
      results = groupResults(results, opts.group as GroupMode, opts.top)
    }

    if (opts.rendered) {
      res.type('text/plain').send(renderResults(results))
    } else {
      res.json(results)
    }
  })

  router.post('/first-seen', async (req, res) => {
    const parsed = FirstSeenBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }

    let queryEmbedding: Embedding
    try {
      queryEmbedding = await textProvider.embed(parsed.data.query)
    } catch (err) {
      res.status(502).json({ error: `Embedding failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }

    const results = vectorSearch(queryEmbedding, { topK: parsed.data.top })

    if (parsed.data.rendered) {
      res.type('text/plain').send(renderFirstSeenResults(results))
    } else {
      res.json(results)
    }
  })

  return router
}
