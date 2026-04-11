import { embedQuery } from '../core/embedding/embedQuery.js'
import { formatDate } from '../core/search/ranking.js'
import type { Embedding } from '../core/models/types.js'

export function serializeSearchResults(results: any[]): string {
  if (results.length === 0) return '(no results)'
  return results
    .map((r: any) => {
      const hash = String(r.blobHash ?? '').slice(0, 7)
      const path = (r.paths && r.paths[0]) ?? '(unknown path)'
      const score = typeof r.score === 'number' ? r.score.toFixed(3) : String(r.score)
      const date = r.firstSeen !== undefined ? `  first: ${formatDate(r.firstSeen)}` : ''
      return `${score}  ${String(path).padEnd(50)}  [${hash}]${date}`
    })
    .join('\n')
}

type EmbedOk = { ok: true; embedding: Embedding }
type EmbedErr = { ok: false; resp: any }
type EmbedResult = EmbedOk | EmbedErr

type McpHandler = (
  args: any,
  helpers: { embed: (provider: any, text: string, prefix?: string) => Promise<EmbedResult>; serializeSearchResults: (r: any[]) => string },
) => any

export function registerTool(server: any, name: string, description: string, schema: any, handler: McpHandler): void {
  server.tool(name, description, schema, async (args: any) => {
    const makeErr = (msg: string) => ({ content: [{ type: 'text', text: msg }] })

    const helpers: { embed: (provider: any, text: string, prefix?: string) => Promise<EmbedResult>; serializeSearchResults: (r: any[]) => string } = {
      embed: async (provider: any, text: string, prefix = 'Error embedding query') => {
        try {
          const emb = await embedQuery(provider, text)
          return { ok: true as const, embedding: emb }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false as const, resp: makeErr(`${prefix}: ${msg}`) }
        }
      },
      serializeSearchResults,
    }

    try {
      return await handler(args, helpers)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return makeErr(`Error: ${msg}`)
    }
  })
}
