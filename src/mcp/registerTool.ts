import { embedQuery } from '../core/embedding/embedQuery.js'
import { formatDate } from '../core/search/ranking.js'

export function serializeSearchResults(results) {
  if (results.length === 0) return '(no results)'
  return results
    .map((r) => {
      const hash = r.blobHash.slice(0, 7)
      const path = r.paths[0] ?? '(unknown path)'
      const score = r.score.toFixed(3)
      const date = r.firstSeen !== undefined ? `  first: ${formatDate(r.firstSeen)}` : ''
      return `${score}  ${path.padEnd(50)}  [${hash}]${date}`
    })
    .join('\n')
}

export function registerTool(server, name, description, schema, handler) {
  server.tool(name, description, schema, async (args) => {
    const makeErr = (msg) => ({ content: [{ type: 'text', text: msg }] })

    const helpers = {
      embed: async (provider, text, prefix = 'Error embedding query') => {
        try {
          const emb = await embedQuery(provider, text)
          return { ok: true, embedding: emb }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, resp: makeErr(`${prefix}: ${msg}`) }
        }
      },
      serializeSearchResults,
    }

    try {
      return await handler(args, helpers)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return makeErr(`Error: ${msg}`)
    }
  })
}
