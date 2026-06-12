import type { SearchResult } from '../../models/types.js'
import { getBlobContent } from '../../indexing/blobStore.js'

export interface ExplainOptions {
  snippetLength?: number
  includeSnippet?: boolean
}

export function formatExplainForLlm(results: SearchResult[], opts: ExplainOptions = {}): string {
  const { snippetLength = 200, includeSnippet = true } = opts
  if (results.length === 0) return '(No results.)'

  const blocks: string[] = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const path = r.paths[0] ?? '(unknown path)'
    const hash = r.blobHash.slice(0, 7)
    const scoreStr = r.score.toFixed(4)
    const firstSeen = r.firstSeen
      ? new Date(r.firstSeen * 1000).toISOString().slice(0, 10)
      : '(unknown date)'

    const lines: string[] = []
    lines.push(`## [${i + 1}] ${path}  (score=${scoreStr})`)
    lines.push(`- Blob: ${hash}`)
    lines.push(`- First seen: ${firstSeen}`)

    if (r.signals) {
      const parts: string[] = [`cosine=${r.signals.cosine.toFixed(4)}`]
      if (r.signals.recency !== undefined) parts.push(`recency=${r.signals.recency.toFixed(4)}`)
      if (r.signals.pathScore !== undefined) parts.push(`pathScore=${r.signals.pathScore.toFixed(4)}`)
      if (r.signals.bm25 !== undefined) parts.push(`bm25=${r.signals.bm25.toFixed(4)}`)
      lines.push(`- Signals: ${parts.join('  ')}`)
    } else {
      lines.push(`- Signals: cosine=${r.score.toFixed(4)}`)
    }

    if (r.paths.length > 1) {
      lines.push(`- Also known as: ${r.paths.slice(1).join(', ')}`)
    }

    if (includeSnippet) {
      try {
        const content = getBlobContent(r.blobHash)
        if (content) {
          const snippet = content.slice(0, snippetLength).replace(/\n/g, ' ')
          lines.push(`- Snippet: ${snippet}${content.length > snippetLength ? '…' : ''}`)
        }
      } catch {
      }
    }

    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n')
}
