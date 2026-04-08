/**
 * `gitsema repl` — interactive semantic search query loop.
 *
 * Launches a persistent readline session where the user can run successive
 * searches without re-embedding the query each time from a cold start.
 * Shared embedding provider is initialised once and reused across queries.
 *
 * Commands inside the REPL:
 *   <query text>           — run semantic search
 *   :top <n>               — set result count
 *   :level file|chunk|symbol — set search level
 *   :hybrid                — toggle hybrid (BM25+vector) search
 *   :help                  — show available REPL commands
 *   :quit / :exit / Ctrl-D — exit
 */

import * as readline from 'node:readline'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { hybridSearch } from '../../core/search/hybridSearch.js'
import { renderResults } from '../../core/search/ranking.js'

export interface ReplOptions {
  top?: string
  level?: string
  hybrid?: boolean
  model?: string
}

export async function replCommand(options: ReplOptions = {}): Promise<void> {
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const modelName = options.model ?? process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'

  // State
  let topK = parseInt(options.top ?? '10', 10)
  if (isNaN(topK) || topK <= 0) topK = 10
  let level = options.level ?? 'file'
  let hybridMode = options.hybrid ?? false
  let historyIdx = 0
  const history: string[] = []

  const provider = buildProvider(providerType, modelName)

  console.log(`gitsema repl — semantic search (model: ${modelName})`)
  console.log(`  :help for commands, :quit to exit`)
  console.log()

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: 'gitsema> ',
    historySize: 100,
  })

  rl.prompt()

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) { rl.prompt(); continue }

    history.unshift(trimmed)
    historyIdx = 0

    // REPL meta-commands
    if (trimmed.startsWith(':')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const cmd = parts[0].toLowerCase()
      switch (cmd) {
        case 'quit':
        case 'exit':
          console.log('Bye.')
          process.exit(0)
          break
        case 'top':
          topK = parseInt(parts[1] ?? '', 10)
          if (isNaN(topK) || topK <= 0) { topK = 10; console.log('Invalid top-k; reset to 10.') }
          else console.log(`top-k set to ${topK}`)
          break
        case 'level':
          if (['file', 'chunk', 'symbol', 'module'].includes(parts[1] ?? '')) {
            level = parts[1]
            console.log(`level set to ${level}`)
          } else {
            console.log('level must be one of: file, chunk, symbol, module')
          }
          break
        case 'hybrid':
          hybridMode = !hybridMode
          console.log(`hybrid search: ${hybridMode ? 'on' : 'off'}`)
          break
        case 'help':
          console.log('  <query>       — semantic search')
          console.log('  :top <n>      — set number of results')
          console.log('  :level <lvl>  — file | chunk | symbol | module')
          console.log('  :hybrid       — toggle hybrid (BM25+vector) mode')
          console.log('  :quit         — exit')
          break
        default:
          console.log(`Unknown command: ${trimmed}`)
      }
      rl.prompt()
      continue
    }

    // Semantic search
    try {
      process.stdout.write('Searching…\r')
      const embedding = await embedQuery(provider, trimmed) as number[]
      const searchOpts = {
        topK,
        searchChunks: level === 'chunk',
        searchSymbols: level === 'symbol',
        searchModules: level === 'module',
      }
      const results = hybridMode
        ? hybridSearch(trimmed, embedding, searchOpts)
        : vectorSearch(embedding, searchOpts)
      process.stdout.write('           \r')
      if (results.length === 0) {
        console.log('No results.')
      } else {
        console.log(renderResults(results, true))
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }

    rl.prompt()
  }
}
