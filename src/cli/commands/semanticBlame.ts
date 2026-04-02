import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { OllamaProvider } from '../../core/embedding/local.js'
import { HttpProvider } from '../../core/embedding/http.js'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import {
  computeSemanticBlame,
  type SemanticBlameEntry,
} from '../../core/search/semanticBlame.js'
import { shortHash } from '../../core/search/ranking.js'

export interface SemanticBlameCommandOptions {
  /** Number of nearest-neighbor blobs per block (default 3). */
  top?: string
  /**
   * When present, write JSON output.  If a string, treat it as the output
   * file path; if a boolean `true`, print JSON to stdout.
   */
  dump?: string | boolean
}

function buildProvider(providerType: string, model: string): EmbeddingProvider {
  if (providerType === 'http') {
    const baseUrl = process.env.GITSEMA_HTTP_URL
    if (!baseUrl) {
      console.error('GITSEMA_HTTP_URL is required when GITSEMA_PROVIDER=http')
      process.exit(1)
    }
    return new HttpProvider({ baseUrl, model, apiKey: process.env.GITSEMA_API_KEY })
  }
  return new OllamaProvider({ model })
}

function formatDate(timestamp: number | null): string {
  if (timestamp === null) return '(unknown)'
  return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

/**
 * Renders semantic blame entries as human-readable CLI output.
 */
function renderResults(filePath: string, entries: SemanticBlameEntry[]): string {
  const out: string[] = [`Semantic blame: ${filePath}`, '']

  for (const entry of entries) {
    const range = `lines ${entry.startLine}–${entry.endLine}`
    const dashCount = Math.max(0, 68 - entry.label.length - range.length)
    out.push(`── ${entry.label} (${range}) ${'─'.repeat(dashCount)}`)

    if (entry.neighbors.length === 0) {
      out.push('  (no indexed blobs — run `gitsema index` first)')
      out.push('')
      continue
    }

    for (let i = 0; i < entry.neighbors.length; i++) {
      const n = entry.neighbors[i]
      const pathStr = n.paths[0] ?? '(unknown path)'
      const extra = n.paths.length > 1 ? ` +${n.paths.length - 1} more` : ''
      const label = i === 0 ? 'Nearest origin' : `Neighbor ${i + 1}    `
      out.push(`  ${label}: ${pathStr}${extra}`)
      out.push(`    blob:       ${shortHash(n.blobHash)}`)
      if (n.commitHash) {
        out.push(`    commit:     ${shortHash(n.commitHash)}  (${formatDate(n.timestamp)})`)
      }
      if (n.author) {
        out.push(`    author:     ${n.author}`)
      }
      if (n.message) {
        const msg = n.message.length > 72 ? n.message.slice(0, 69) + '...' : n.message
        out.push(`    message:    ${msg}`)
      }
      out.push(`    similarity: ${n.similarity.toFixed(4)}`)
      if (i < entry.neighbors.length - 1) out.push('')
    }
    out.push('')
  }

  return out.join('\n')
}

export async function semanticBlameCommand(
  filePath: string,
  options: SemanticBlameCommandOptions,
): Promise<void> {
  if (!filePath || filePath.trim() === '') {
    console.error('Error: file path is required')
    process.exit(1)
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 3
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  const resolvedPath = resolve(filePath.trim())
  if (!existsSync(resolvedPath)) {
    console.error(`Error: file not found: ${resolvedPath}`)
    process.exit(1)
  }

  let content: string
  try {
    content = readFileSync(resolvedPath, 'utf8')
  } catch (err) {
    console.error(`Error reading file: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const model = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const provider = buildProvider(providerType, model)

  let entries: SemanticBlameEntry[]
  try {
    entries = await computeSemanticBlame(filePath.trim(), content, provider, { topK })
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (options.dump !== undefined) {
    const json = JSON.stringify(entries, null, 2)
    if (typeof options.dump === 'string') {
      writeFileSync(options.dump, json, 'utf8')
      console.log(`Wrote semantic blame JSON to ${options.dump}`)
    } else {
      console.log(json)
    }
    return
  }

  console.log(renderResults(filePath.trim(), entries))
}
