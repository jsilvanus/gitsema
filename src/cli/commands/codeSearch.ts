import { Command } from 'commander'
import { getCodeProvider } from '../../core/embedding/providerFactory.js'
import { vectorSearch, type VectorSearchOptions } from '../../core/search/analysis/vectorSearch.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { renderResults, renderResultsByLevel } from '../../core/search/ranking.js'
import { resolveExtraLevels, isMultiLevelActive, type LevelFlags } from './search.js'
import type { SearchResult } from '../../core/models/types.js'

export function codeSearchCommand(): Command {
  return new Command('code-search')
    .description('Find code semantically similar to a given snippet')
    .argument('<snippet>', 'Code snippet to search for')
    .option('-k, --top <n>', 'Number of results', '10')
    .option('--level <level>', 'Search level: file, chunk, symbol (default: symbol)', 'symbol')
    .option('--model <model>', 'Embedding model override')
    .option('--branch <branch>', 'Restrict to blobs on this branch')
    .option('--threshold <n>', 'Minimum similarity score (0-1)', '0')
    .option('--merge-levels', 'Merge chunk/symbol pools into one shared-cutoff ranked list (pre-Phase-137 behavior) instead of separate per-level lists')
    .option('--no-headings', "don't print column header row")
    .action(async (snippet: string, options: { top: string; level: string; model?: string; branch?: string; threshold: string; mergeLevels?: boolean; noHeadings?: boolean }) => {
      const topK = parseInt(options.top, 10)
      const threshold = parseFloat(options.threshold)
      const codeProvider = getCodeProvider()
      const queryEmbedding = await embedQuery(codeProvider, snippet)

      const searchChunksFlag = options.level === 'chunk' || options.level === 'symbol'
      const searchSymbolsFlag = options.level === 'symbol'

      const baseOpts: VectorSearchOptions = {
        topK,
        model: options.model ?? codeProvider.model,
        branch: options.branch,
      }

      const filterFn = (results: SearchResult[]): SearchResult[] =>
        threshold > 0 ? results.filter((r) => r.score >= threshold) : results

      // Phase 137: code-search's default level ('symbol') sets both
      // searchChunks and searchSymbols simultaneously — the same cross-pool
      // crowding-out condition Phase 136 fixed for `search`'s opt-in
      // multi-level combinations. Isolate each active level into its own
      // candidate pool/topK cutoff by default; --merge-levels restores the
      // pre-Phase-137 single merged call.
      const extraLevels = resolveExtraLevels(searchChunksFlag, searchSymbolsFlag, false)
      const multiLevelActive = isMultiLevelActive(extraLevels)

      async function runLevel(flags: LevelFlags): Promise<SearchResult[]> {
        const results = await vectorSearch(queryEmbedding, { ...baseOpts, ...flags })
        return filterFn(results)
      }

      if (multiLevelActive && !options.mergeLevels) {
        const resultsByLevel: Record<string, SearchResult[]> = {}
        resultsByLevel.file = await runLevel({ searchChunks: false, searchSymbols: false, searchModules: false, includeFiles: true })
        for (const level of extraLevels) {
          resultsByLevel[level.name] = await runLevel(level.flags)
        }
        console.log(renderResultsByLevel(resultsByLevel, !options.noHeadings))
      } else {
        const results = await runLevel({ searchChunks: searchChunksFlag, searchSymbols: searchSymbolsFlag, searchModules: false, includeFiles: true })
        console.log(renderResults(results, !options.noHeadings))
      }
    })
}
