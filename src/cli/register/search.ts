import { Command } from 'commander'
import { searchCommand } from '../commands/search.js'
import { codeSearchCommand } from '../commands/codeSearch.js'
import { reposCommand } from '../commands/repos.js'
import { lspCommand } from '../commands/lsp.js'
import { watchCommand } from '../commands/watch.js'
import { securityScanCommand } from '../commands/securityScan.js'
import { healthCommand } from '../commands/health.js'
import { debtCommand } from '../commands/debt.js'
import { toolsCommand } from '../commands/tools.js'
import { collectOut } from '../../utils/outputSink.js'

export function registerSearch(program: Command) {
  program
    .command('search <query>')
    .description('Semantically search the index for blobs matching the query')
    .option('-k, --top <n>', 'number of results to return', '10')
    .option('--recent', 'blend cosine similarity with a recency score')
    .option('--alpha <n>', 'weight for cosine similarity in blended score (0–1, default 0.8)')
    .option('--before <date>', 'only include blobs first seen before this date (YYYY-MM-DD)')
    .option('--after <date>', 'only include blobs first seen after this date (YYYY-MM-DD)')
    .option('--weight-vector <n>', 'weight for vector similarity in three-signal ranking (default 0.7)')
    .option('--weight-recency <n>', 'weight for recency in three-signal ranking (default 0.2)')
    .option('--weight-path <n>', 'weight for path relevance in three-signal ranking (default 0.1)')
    .option('--group <mode>', 'group results by: file, module, or commit')
    .option('--chunks', 'include chunk-level embeddings in search results')
    .option('--level <level>', 'search level: file, chunk, symbol, or module')
    .option('--hybrid', 'combine vector similarity with BM25 keyword matching (FTS5)')
    .option('--bm25-weight <n>', 'weight for the BM25 signal in hybrid search (0–1, default 0.3)')
    .option('--remote <url>', 'proxy search to a remote gitsema server (overrides GITSEMA_REMOTE)')
    .option('--branch <name>', 'only return blobs seen on this branch (short name, e.g. "main")')
    .option('--no-cache', 'skip the query embedding cache (bypass both reads and writes; for deterministic runs)')
    .option('--include-commits', 'also search commit message embeddings and display matching commits')
    .option('--annotate-clusters', 'annotate each result with its cluster label from a prior `gitsema clusters` run')
    .option('--vss', 'use the usearch HNSW ANN index for approximate search (requires prior `gitsema build-vss`; falls back to linear scan if unavailable)')
    .option('--model <model>', 'override embedding model')
    .option('--text-model <model>', 'override text embedding model')
    .option('--code-model <model>', 'override code embedding model')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout (legacy: prefer --out json)')
    .option('--not-like <query>', 'negative example query whose similarity is subtracted from the score')
    .option('--lambda <n>', 'weight for the negative example subtraction (default 0.5)')
    .option('--explain', 'show score component breakdown for each result')
    .option('--early-cut <n>', 'limit candidate pool to n random samples to speed up search on large indexes')
    .option('--explain-llm', 'output LLM-ready provenance citation block for each result')
    .option('--html [file]', 'output interactive HTML; writes to <file> if given, otherwise search.html (legacy: prefer --out html)')
    .option('--or <query>', 'combine results with OR (union, max score)')
    .option('--and <query>', 'combine results with AND (intersection, harmonic mean)')
    .option('--expand-query', 'expand query with top BM25 keywords before embedding to improve recall (Phase 52)')
    .option('--narrate', 'generate an LLM summary of search results (requires GITSEMA_LLM_URL)')
    .option('--repos <ids>', 'comma-separated repo IDs to include in search (multi-repo; use gitsema repos add to register)')
    .option('--no-headings', "don't print column header row")
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
    .action(searchCommand)

  program.addCommand(codeSearchCommand())
  program.addCommand(reposCommand())
  // Keep top-level lsp as hidden alias; preferred form is `gitsema tools lsp`
  program.addCommand(lspCommand(), { hidden: true })
  program.addCommand(watchCommand())
  program.addCommand(securityScanCommand())
  program.addCommand(healthCommand())
  program.addCommand(debtCommand())
  program.addCommand(toolsCommand())
}
