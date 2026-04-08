import { embedQuery } from '../core/embedding/embedQuery.js'
import { formatDate } from '../core/search/ranking.js'

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

import type { Embedding } from '../core/models/types.js'

type McpHandler = (args: any, helpers: { embed: (provider: any, text: string, prefix?: string) => Promise<{ ok: boolean; embedding?: Embedding; resp?: any }>; serializeSearchResults: (r: any[]) => string }) => Promise<any> | any

export function registerTool(server: any, name: string, description: string, schema: any, handler: McpHandler): void {
  server.tool(name, description, schema, async (args: any) => {
    const makeErr = (msg: string) => ({ content: [{ type: 'text', text: msg }] })

    const helpers = {
      embed: async (provider: any, text: string, prefix = 'Error embedding query') => {
        try {
          const emb = await embedQuery(provider, text)
          return { ok: true, embedding: emb }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, resp: makeErr(`${prefix}: ${msg}`) }
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
