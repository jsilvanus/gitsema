import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { parseDateArg } from '../../core/search/timeSearch.js'

function embeddingToBuffer(vec: number[] | Float32Array): Buffer {
  const f32 = Float32Array.from(vec)
  return Buffer.from(f32.buffer)
}

function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

export function watchCommand(): Command {
  const cmd = new Command('watch')
    .description('Manage saved searches and watch mode notifications (Phase 53)')

  cmd
    .command('add <name> <query>')
    .description('Save a named search query for periodic watching')
    .option('--webhook <url>', 'webhook URL to POST new matches to')
    .action(async (name: string, query: string, opts: { webhook?: string }) => {
      const session = getActiveSession()
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)
      let embBuf: Buffer | null = null
      try {
        const emb = await embedQuery(provider, query)
        embBuf = embeddingToBuffer(Array.isArray(emb) ? emb : Array.from(emb))
      } catch {
        // Store query without embedding — will re-embed on run
      }
      const now = Math.floor(Date.now() / 1000)
      session.rawDb.prepare(
        `INSERT OR REPLACE INTO saved_queries (name, query_text, query_embedding, last_run_ts, webhook_url, created_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      ).run(name, query, embBuf, opts.webhook ?? null, now)
      console.log(`Saved query '${name}': ${query}${opts.webhook ? ` → ${opts.webhook}` : ''}`)
    })

  cmd
    .command('list')
    .description('List all saved search queries')
    .action(() => {
      const session = getActiveSession()
      const rows = session.rawDb.prepare(
        `SELECT id, name, query_text, last_run_ts, webhook_url FROM saved_queries ORDER BY created_at DESC`,
      ).all() as Array<{ id: number; name: string; query_text: string; last_run_ts: number | null; webhook_url: string | null }>
      if (rows.length === 0) {
        console.log('No saved queries. Use: gitsema watch add <name> <query>')
        return
      }
      for (const r of rows) {
        const last = r.last_run_ts ? new Date(r.last_run_ts * 1000).toISOString().slice(0, 10) : 'never'
        console.log(`[${r.id}] ${r.name}  last: ${last}  query: "${r.query_text}"${r.webhook_url ? `  webhook: ${r.webhook_url}` : ''}`)
      }
    })

  cmd
    .command('remove <name>')
    .description('Remove a saved query by name')
    .action((name: string) => {
      const session = getActiveSession()
      const result = session.rawDb.prepare(`DELETE FROM saved_queries WHERE name = ?`).run(name)
      if ((result as any).changes === 0) {
        console.error(`No saved query found with name '${name}'`)
        process.exit(1)
      }
      console.log(`Removed saved query '${name}'`)
    })

  cmd
    .command('run')
    .description('Run all saved queries and print new matches since last run')
    .option('--top <n>', 'max results per query', '10')
    .action(async (opts: { top?: string }) => {
      const topK = parseInt(opts.top ?? '10', 10)
      const session = getActiveSession()
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)

      const rows = session.rawDb.prepare(
        `SELECT id, name, query_text, query_embedding, last_run_ts, webhook_url FROM saved_queries ORDER BY created_at ASC`,
      ).all() as Array<{ id: number; name: string; query_text: string; query_embedding: Buffer | null; last_run_ts: number | null; webhook_url: string | null }>

      if (rows.length === 0) {
        console.log('No saved queries. Use: gitsema watch add <name> <query>')
        return
      }

      for (const row of rows) {
        console.log(`\n=== ${row.name} ===`)
        let emb: number[]
        if (row.query_embedding) {
          emb = bufferToEmbedding(row.query_embedding)
        } else {
          try {
            const raw = await embedQuery(provider, row.query_text)
            emb = Array.isArray(raw) ? raw : Array.from(raw)
          } catch (e) {
            console.error(`  Error embedding query: ${e instanceof Error ? e.message : String(e)}`)
            continue
          }
        }

        const afterTs = row.last_run_ts ?? undefined
        const results = vectorSearch(emb, {
          topK,
          model,
          after: afterTs,
        })

        const now = Math.floor(Date.now() / 1000)
        session.rawDb.prepare(`UPDATE saved_queries SET last_run_ts = ? WHERE id = ?`).run(now, row.id)

        if (results.length === 0) {
          console.log('  No new matches since last run.')
          continue
        }

        console.log(`  ${results.length} new match(es):`)
        for (const r of results) {
          const path = r.paths?.[0] ?? r.blobHash.slice(0, 8)
          console.log(`  ${r.score.toFixed(3)}  ${path}`)
        }

        // POST to webhook if configured
        if (row.webhook_url) {
          try {
            const body = JSON.stringify({ query: row.name, results })
            const { default: https } = await import('node:https')
            const url = new URL(row.webhook_url)
            // Only allow HTTPS webhooks to prevent downgrade attacks
            if (url.protocol !== 'https:') {
              console.error(`  Skipping webhook (only https:// is allowed): ${row.webhook_url}`)
              continue
            }
            const req = https.request({
              hostname: url.hostname,
              port: url.port || 443,
              path: url.pathname + url.search,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            })
            req.write(body)
            req.end()
          } catch {
            // Webhook failure is non-fatal
          }
        }
      }
    })

  return cmd
}
