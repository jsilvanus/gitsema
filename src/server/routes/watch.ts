/**
 * Watch routes for saved searches (Phase 53).
 * POST /watch/add   — save a named query
 * POST /watch/run   — execute all saved queries and return new matches
 */

import { Router } from 'express'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { getActiveSession } from '../../core/db/sqlite.js'

function embeddingToBuffer(vec: number[] | Float32Array): Buffer {
  const f32 = Float32Array.from(vec)
  return Buffer.from(f32.buffer)
}

function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

export interface WatchRouterDeps {
  textProvider: EmbeddingProvider
}

export function watchRouter(deps: WatchRouterDeps): Router {
  const { textProvider } = deps
  const router = Router()

  const AddBodySchema = z.object({
    name: z.string().min(1),
    query: z.string().min(1),
    webhookUrl: z.string().url().optional(),
  })
  router.post('/add', async (req, res) => {
    const parsed = AddBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const { name, query, webhookUrl } = parsed.data
    try {
      const session = getActiveSession()
      let embBuf: Buffer | null = null
      try {
        const emb = await embedQuery(textProvider, query)
        embBuf = embeddingToBuffer(Array.isArray(emb) ? emb : Array.from(emb))
      } catch {
        // non-fatal
      }
      const now = Math.floor(Date.now() / 1000)
      session.rawDb.prepare(
        `INSERT OR REPLACE INTO saved_queries (name, query_text, query_embedding, last_run_ts, webhook_url, created_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      ).run(name, query, embBuf, webhookUrl ?? null, now)
      res.json({ ok: true, name, query })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  const RunBodySchema = z.object({
    topK: z.number().int().positive().optional().default(10),
    model: z.string().optional(),
  })
  router.post('/run', async (req, res) => {
    const parsed = RunBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
      return
    }
    const { topK, model } = parsed.data
    try {
      const session = getActiveSession()
      const rows = session.rawDb.prepare(
        `SELECT id, name, query_text, query_embedding, last_run_ts FROM saved_queries ORDER BY created_at ASC`,
      ).all() as Array<{ id: number; name: string; query_text: string; query_embedding: Buffer | null; last_run_ts: number | null }>

      const output: Array<{ name: string; newMatches: number; results: unknown[] }> = []
      const now = Math.floor(Date.now() / 1000)

      for (const row of rows) {
        let emb: number[]
        if (row.query_embedding) {
          emb = bufferToEmbedding(row.query_embedding)
        } else {
          try {
            const raw = await embedQuery(textProvider, row.query_text)
            emb = Array.isArray(raw) ? raw : Array.from(raw)
          } catch {
            output.push({ name: row.name, newMatches: 0, results: [] })
            continue
          }
        }
        const results = vectorSearch(emb, {
          topK,
          model,
          after: row.last_run_ts ?? undefined,
        })
        session.rawDb.prepare(`UPDATE saved_queries SET last_run_ts = ? WHERE id = ?`).run(now, row.id)
        output.push({ name: row.name, newMatches: results.length, results })
      }

      res.json(output)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  return router
}
