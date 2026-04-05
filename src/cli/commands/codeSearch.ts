import { Command } from 'commander'
import { getCodeProvider } from '../../core/embedding/providerFactory.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { renderResults } from '../../core/search/ranking.js'

export function codeSearchCommand(): Command {
  return new Command('code-search')
    .description('Find code semantically similar to a given snippet')
    .argument('<snippet>', 'Code snippet to search for')
    .option('-k, --top <n>', 'Number of results', '10')
    .option('--level <level>', 'Search level: file, chunk, symbol (default: symbol)', 'symbol')
    .option('--model <model>', 'Embedding model override')
    .option('--branch <branch>', 'Restrict to blobs on this branch')
    .option('--threshold <n>', 'Minimum similarity score (0-1)', '0')
    .action(async (snippet: string, options: { top: string; level: string; model?: string; branch?: string; threshold: string }) => {
      const topK = parseInt(options.top, 10)
      const threshold = parseFloat(options.threshold)
      const codeProvider = getCodeProvider()
      const queryEmbedding = await embedQuery(codeProvider, snippet)
      const results = vectorSearch(queryEmbedding, {
        topK,
        model: options.model ?? codeProvider.model,
        searchChunks: options.level === 'chunk' || options.level === 'symbol',
        searchSymbols: options.level === 'symbol',
        branch: options.branch,
      })
      const filtered = threshold > 0 ? results.filter((r) => r.score >= threshold) : results
      console.log(renderResults(filtered))
    })
}
