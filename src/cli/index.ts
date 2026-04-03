import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { statusCommand } from './commands/status.js'
import { indexCommand } from './commands/index.js'
import { searchCommand } from './commands/search.js'
import { firstSeenCommand } from './commands/firstSeen.js'
import { evolutionCommand } from './commands/evolution.js'
import { conceptEvolutionCommand } from './commands/conceptEvolution.js'
import { diffCommand } from './commands/diff.js'
import { semanticDiffCommand } from './commands/semanticDiff.js'
import { startMcpServer } from '../mcp/server.js'
import { backfillFtsCommand } from './commands/backfillFts.js'
import { serveCommand } from './commands/serve.js'
import { remoteIndexCommand } from './commands/remoteIndex.js'
import { semanticBlameCommand } from './commands/semanticBlame.js'
import { deadConceptsCommand } from './commands/deadConcepts.js'
import { impactCommand } from './commands/impact.js'
import { clustersCommand } from './commands/clusters.js'
import { clusterDiffCommand } from './commands/clusterDiff.js'
import { clusterTimelineCommand } from './commands/clusterTimeline.js'
import { changePointsCommand } from './commands/changePoints.js'
import { fileChangePointsCommand } from './commands/fileChangePoints.js'
import { clusterChangePointsCommand } from './commands/clusterChangePoints.js'

const program = new Command()

// Accept a top-level `--verbose` flag so Commander does not reject it.
program.option('--verbose', 'Enable verbose debug logging')

// Honor `--verbose` early by setting an env var so other modules (logger)
// pick it up when they load.
if (process.argv.includes('--verbose')) process.env.GITSEMA_VERBOSE = '1'

// Read package.json version dynamically so `gitsema -V` matches package.json
let pkgVersion = '0.0.0'
try {
  const pkgPath = new URL('../../package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg && typeof pkg.version === 'string') pkgVersion = pkg.version
} catch {
  // fall back to default
}

program
  .name('gitsema')
  .description('A content-addressed semantic index synchronized with Git\'s object model.')
  .version(pkgVersion)

// ---------------------------------------------------------------------------
// --help group headers (Commander 12 does not have addHelpGroup; we override
// formatHelp to inject group headings into the top-level command listing).
// ---------------------------------------------------------------------------

const GROUPS = [
  'Setup & Infrastructure',
  'Search & Discovery',
  'File History',
  'Concept History',
  'Cluster Analysis',
  'Change Detection',
] as const

const COMMAND_GROUPS: Record<string, string> = {
  // Setup & Infrastructure
  status:           'Setup & Infrastructure',
  index:            'Setup & Infrastructure',
  serve:            'Setup & Infrastructure',
  'remote-index':   'Setup & Infrastructure',
  'backfill-fts':   'Setup & Infrastructure',
  mcp:              'Setup & Infrastructure',
  // Search & Discovery
  search:           'Search & Discovery',
  'first-seen':     'Search & Discovery',
  'dead-concepts':  'Search & Discovery',
  // File History
  'file-evolution': 'File History',
  'file-diff':      'File History',
  blame:            'File History',
  'semantic-blame': 'File History',   // backward-compat alias
  impact:           'File History',
  // Concept History
  evolution:           'Concept History',   // primary name (was concept-evolution)
  'concept-evolution': 'Concept History',   // backward-compat alias
  diff:                'Concept History',   // semantic diff across refs
  // Cluster Analysis
  clusters:           'Cluster Analysis',
  'cluster-diff':     'Cluster Analysis',
  'cluster-timeline': 'Cluster Analysis',
  // Change Detection
  'change-points':         'Change Detection',
  'file-change-points':    'Change Detection',
  'cluster-change-points': 'Change Detection',
}

program.configureHelp({
  formatHelp(cmd, helper) {
    const termWidth = helper.padWidth(cmd, helper)
    const helpWidth = helper.helpWidth ?? 80
    const itemIndentWidth = 2
    const itemSeparatorWidth = 2

    function formatItem(term: string, description: string): string {
      if (description) {
        const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`
        return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth)
      }
      return term
    }
    function formatList(textArray: string[]): string {
      return textArray.join('\n').replace(/^/gm, ' '.repeat(itemIndentWidth))
    }

    // Usage
    let output: string[] = [`Usage: ${helper.commandUsage(cmd)}`, '']

    // Description
    const commandDescription = helper.commandDescription(cmd)
    if (commandDescription.length > 0) {
      output = output.concat([helper.wrap(commandDescription, helpWidth, 0), ''])
    }

    // Arguments
    const argumentList = helper.visibleArguments(cmd).map((argument) =>
      formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument)),
    )
    if (argumentList.length > 0) {
      output = output.concat(['Arguments:', formatList(argumentList), ''])
    }

    // Options
    const optionList = helper.visibleOptions(cmd).map((option) =>
      formatItem(helper.optionTerm(option), helper.optionDescription(option)),
    )
    if (optionList.length > 0) {
      output = output.concat(['Options:', formatList(optionList), ''])
    }

    // Global options (if enabled)
    if (helper.showGlobalOptions) {
      const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) =>
        formatItem(helper.optionTerm(option), helper.optionDescription(option)),
      )
      if (globalOptionList.length > 0) {
        output = output.concat(['Global Options:', formatList(globalOptionList), ''])
      }
    }

    // Commands — sorted into groups
    const allCommands = helper.visibleCommands(cmd)
    if (allCommands.length > 0) {
      const grouped = new Map<string, string[]>()
      const ungrouped: string[] = []

      for (const subcmd of allCommands) {
        const group = COMMAND_GROUPS[subcmd.name()]
        const item = formatItem(helper.subcommandTerm(subcmd), helper.subcommandDescription(subcmd))
        if (group) {
          if (!grouped.has(group)) grouped.set(group, [])
          grouped.get(group)!.push(item)
        } else {
          ungrouped.push(item)
        }
      }

      for (const groupName of GROUPS) {
        const items = grouped.get(groupName)
        if (items?.length) {
          output = output.concat([`${groupName}:`, formatList(items), ''])
        }
      }

      if (ungrouped.length > 0) {
        output = output.concat(['Commands:', formatList(ungrouped), ''])
      }
    }

    return output.join('\n')
  },
})

program
  .command('status [file]')
  .description('Show index status and database info, or status for a specific file')
  .option('--remote <url>', 'remote server URL (overrides GITSEMA_REMOTE)')
  .action(statusCommand)

program
  .command('index')
  .description('Index all blobs in the current Git repo')
  .option(
    '--since <ref>',
    'only index commits after this point; accepts a date (2024-01-01), tag (v1.0), or commit hash; use "all" to force a full re-index',
  )
  .option(
    '--max-commits <n>',
    'stop after indexing this many commits; pair with incremental indexing to split large histories into multiple sessions',
  )
  .option(
    '--concurrency <n>',
    'number of blobs to embed concurrently (default 4)',
  )
  .option(
    '--ext <extensions>',
    'only index files with these comma-separated extensions, e.g. ".ts,.js,.py"',
  )
  .option(
    '--max-size <size>',
    'skip blobs larger than this size, e.g. "200kb", "1mb" (default 200kb)',
  )
  .option(
    '--exclude <patterns>',
    'skip blobs whose path contains any of these comma-separated patterns, e.g. "node_modules,dist,vendor"',
  )
  .option(
    '--chunker <strategy>',
    'chunking strategy: file (default, whole-file), function (function/class boundaries), fixed (fixed-size windows)',
  )
  .option(
    '--window-size <n>',
    'target chunk size in characters for the fixed chunker (default 1500)',
  )
  .option(
    '--overlap <n>',
    'overlap in characters between adjacent fixed chunks (default 200)',
  )
  .option(
    '--file <paths...>',
    'index specific file(s) from HEAD (can supply multiple paths)'
  )
  .option(
    '--remote <url>',
    'send blobs to a remote gitsema server for embedding (overrides GITSEMA_REMOTE)',
  )
  .option(
    '--branch <name>',
    'restrict indexing to commits reachable from this branch (short name, e.g. "main")',
  )
  .action(indexCommand)

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
  .option('--hybrid', 'combine vector similarity with BM25 keyword matching (FTS5)')
  .option('--bm25-weight <n>', 'weight for the BM25 signal in hybrid search (0–1, default 0.3)')
  .option('--remote <url>', 'proxy search to a remote gitsema server (overrides GITSEMA_REMOTE)')
  .option('--branch <name>', 'only return blobs seen on this branch (short name, e.g. "main")')
  .option('--no-cache', 'skip the query embedding cache (bypass both reads and writes; for deterministic runs)')
  .option('--include-commits', 'also search commit message embeddings and display matching commits')
  .action(searchCommand)

program
  .command('first-seen <query>')
  .description('Find when a concept first appeared in the codebase, sorted by date (see also: search, concept-evolution)')
  .option('-k, --top <n>', 'number of results to return', '10')
  .option('--remote <url>', 'proxy to a remote gitsema server (overrides GITSEMA_REMOTE)')
  .action(firstSeenCommand)

program
  .command('file-evolution <path>')
  .description('Track semantic drift of a file over its Git history (see also: file-diff, evolution)')
  .option(
    '--threshold <n>',
    'cosine distance threshold above which a version change is flagged as a large change (default 0.3)',
  )
  .option(
    '--dump [file]',
    'output structured JSON of all evolution entries; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--include-content',
    'include the stored file content for each version in the JSON dump (only used with --dump)',
  )
  .option(
    '--alerts [n]',
    'show the top-N largest semantic jumps (default 5) with author and commit link; use with --dump to include in JSON output',
  )
  .option('--remote <url>', 'proxy to a remote gitsema server (overrides GITSEMA_REMOTE)')
  .action(evolutionCommand)

program
  .command('evolution <query>')
  .alias('concept-evolution')
  .description('Show how a semantic concept evolved across the commit history (see also: file-evolution, first-seen)')
  .option('-k, --top <n>', 'number of top-matching blobs to include in the timeline (default 50)')
  .option(
    '--threshold <n>',
    'cosine distance threshold above which a timeline step is flagged as a large change (default 0.3)',
  )
  .option(
    '--dump [file]',
    'output structured JSON of all entries; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise concept-evolution.html',
  )
  .option(
    '--include-content',
    'include the stored file content for each entry in the JSON dump (only used with --dump)',
  )
  .option('--remote <url>', 'proxy to a remote gitsema server (overrides GITSEMA_REMOTE)')
  .action(conceptEvolutionCommand)

program
  .command('file-diff <ref1> <ref2> <path>')
  .description('Compute semantic diff between two versions of a file (see also: file-evolution, cluster-diff, diff)')
  .option(
    '--neighbors <n>',
    'number of nearest-neighbour blobs to show for each version (default 0)',
  )
  .action(diffCommand)

program
  .command('diff <ref1> <ref2> <query>')
  .description('Compute a conceptual/semantic diff of a topic across two git refs — shows gained, lost, and stable concepts (see also: file-diff, evolution)')
  .option('-k, --top <n>', 'max results to show per group (gained/lost/stable)', '10')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .action(semanticDiffCommand)

program
  .command('serve')
  .description('Start the gitsema HTTP API server (embedding and storage backend)')
  .option('--port <n>', 'port to listen on (default 4242, overrides GITSEMA_SERVE_PORT)')
  .option('--key <token>', 'require this Bearer token for all requests (overrides GITSEMA_SERVE_KEY)')
  .option(
    '--chunker <strategy>',
    'chunking strategy for incoming blobs: file (default), function, fixed',
  )
  .option('--concurrency <n>', 'max concurrent embedding calls (default 4)')
  .action(serveCommand)

program
  .command('remote-index <repoUrl>')
  .description('Ask a remote gitsema server to clone and index a Git repository (Phase 16 + 17)')
  .option('--remote <url>', 'remote gitsema server URL (overrides GITSEMA_REMOTE)')
  .option('--token <token>', 'HTTPS Git credential token (uses GIT_ASKPASS, never in process list)')
  .option('--ssh-key <path>', 'path to a PEM-encoded SSH private key file for SSH repository URLs')
  .option('--depth <n>', 'shallow clone depth (omit for full clone)')
  .option(
    '--since <ref>',
    'only index commits after this point; accepts a date, tag, commit hash, or "all"',
  )
  .option('--max-commits <n>', 'stop after indexing this many commits')
  .option('--concurrency <n>', 'parallel embedding workers on the server (default 4)')
  .option('--ext <extensions>', 'only index files with these comma-separated extensions')
  .option('--max-size <size>', 'skip blobs larger than this size, e.g. "200kb"')
  .option('--exclude <patterns>', 'skip blobs whose path contains these comma-separated patterns')
  .option('--chunker <strategy>', 'chunking strategy: file (default), function, fixed')
  .option('--window-size <n>', 'chunk size in characters for the fixed chunker (default 1500)')
  .option('--overlap <n>', 'character overlap between adjacent fixed chunks (default 200)')
  .option(
    '--db-label <label>',
    'route indexing to .gitsema/<label>.db on the server (1–64 alphanumeric chars or hyphens)',
  )
  .action(remoteIndexCommand)

program
  .command('blame <file>')
  .alias('semantic-blame')
  .description('Show semantic origin of each logical block in a file — nearest-neighbor blame (see also: file-evolution, impact)')
  .option('-k, --top <n>', 'number of nearest-neighbor blobs to show per block (default 3)', '3')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .action(semanticBlameCommand)

program
  .command('dead-concepts')
  .description('Find historical concepts no longer in HEAD but semantically similar to current code (see also: search, concept-evolution)')
  .option('-k, --top <n>', 'number of results to return', '10')
  .option(
    '--since <date>',
    'only consider dead blobs whose latest commit is on or after this date (YYYY-MM-DD or ISO 8601)',
  )
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .action(deadConceptsCommand)

program
  .command('impact <path>')
  .description('Compute semantically similar blobs across the codebase to highlight refactor impact (see also: blame, file-diff)')
  .option('-k, --top <n>', 'number of similar blobs to return', '10')
  .option('--chunks', 'include chunk-level embeddings for finer-grained coupling')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .action(impactCommand)

program
  .command('clusters')
  .description('Cluster all blob embeddings into semantic regions and display a concept graph (see also: cluster-diff, cluster-timeline)')
  .option('--k <n>', 'number of clusters to compute (default 8)', '8')
  .option('--top <n>', 'top representative paths to show per cluster (default 5)', '5')
  .option('--iterations <n>', 'max k-means iterations (default 20)', '20')
  .option('--edge-threshold <n>', 'cosine similarity threshold for concept graph edges (default 0.3)', '0.3')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise clusters.html',
  )
  .option('--enhanced-labels', 'enhance cluster labels using TF-IDF path and identifier analysis')
  .option('--enhanced-keywords-n <n>', 'number of enhanced keywords to compute per cluster (default 5)', '5')
  .action(clustersCommand)

program
  .command('cluster-diff <ref1> <ref2>')
  .description('Compare semantic clusters between two points in history — temporal clustering (see also: clusters, cluster-timeline, file-diff)')
  .option('--k <n>', 'number of clusters to compute at each ref (default 8)', '8')
  .option('--top <n>', 'top representative paths to show per cluster (default 5)', '5')
  .option('--iterations <n>', 'max k-means iterations (default 20)', '20')
  .option('--edge-threshold <n>', 'cosine similarity threshold for concept graph edges (default 0.3)', '0.3')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise cluster-diff.html',
  )
  .option('--enhanced-labels', 'enhance cluster labels using TF-IDF path and identifier analysis')
  .option('--enhanced-keywords-n <n>', 'number of enhanced keywords to compute per cluster (default 5)', '5')
  .action(clusterDiffCommand)

program
  .command('cluster-timeline')
  .description('Show how semantic clusters shifted over the commit history — multi-step timeline (see also: clusters, cluster-diff)')
  .option('--k <n>', 'number of clusters per step (default 8)', '8')
  .option('--steps <n>', 'number of evenly-spaced time checkpoints (default 5)', '5')
  .option('--since <ref>', 'start date or git ref for the timeline (default: earliest indexed commit)')
  .option('--until <ref>', 'end date or git ref for the timeline (default: latest indexed commit)')
  .option('--top <n>', 'top representative paths to show per cluster (default 5)', '5')
  .option('--iterations <n>', 'max k-means iterations per step (default 20)', '20')
  .option('--edge-threshold <n>', 'cosine similarity threshold for concept graph edges (default 0.3)', '0.3')
  .option('--threshold <n>', 'centroid-drift threshold above which a cluster is flagged as relabeled (default 0.15)', '0.15')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise cluster-timeline.html',
  )
  .option('--enhanced-labels', 'enhance cluster labels using TF-IDF path and identifier analysis')
  .option('--enhanced-keywords-n <n>', 'number of enhanced keywords to compute per cluster (default 5)', '5')
  .action(clusterTimelineCommand)

program
  .command('change-points <query>')
  .description('Detect conceptual change points for a semantic query across commit history (see also: concept-evolution, cluster-change-points)')
  .option('-k, --top <n>', 'number of top-matching blobs used to define concept state per commit (default 50)', '50')
  .option('--threshold <n>', 'cosine distance threshold to flag a change point (default 0.3)', '0.3')
  .option('--top-points <n>', 'show top-N largest shifts (default 5)', '5')
  .option('--since <ref>', 'limit commits from this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option('--until <ref>', 'limit commits up to this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .action(changePointsCommand)

program
  .command('file-change-points <path>')
  .description('Detect semantic change points in a file\'s Git history (see also: file-evolution, change-points)')
  .option('--threshold <n>', 'cosine distance threshold to flag a change point (default 0.3)', '0.3')
  .option('--top-points <n>', 'show top-N largest shifts (default 5)', '5')
  .option('--since <ref>', 'limit commits from this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option('--until <ref>', 'limit commits up to this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .action(fileChangePointsCommand)

program
  .command('cluster-change-points')
  .description('Detect change points in the repo\'s cluster structure across commit history (see also: cluster-timeline, change-points)')
  .option('--k <n>', 'number of clusters to compute per step (default 8)', '8')
  .option('--threshold <n>', 'mean centroid shift threshold to flag a change point (default 0.3)', '0.3')
  .option('--top-points <n>', 'show top-N largest shifts (default 5)', '5')
  .option('--since <ref>', 'limit commits from this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option('--until <ref>', 'limit commits up to this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option(
    '--max-commits <n>',
    'cap the number of commits evaluated (sampled evenly across the range); omit to evaluate every commit',
  )
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .action(clusterChangePointsCommand)

program
  .command('backfill-fts')
  .description('Populate FTS5 content for blobs indexed before Phase 11 (enables hybrid search and --include-content)')
  .action(async () => {
    await backfillFtsCommand()
  })

program
  .command('mcp')
  .description('Start the gitsema MCP server (stdio transport)')
  .action(async () => {
    await startMcpServer()
  })

program.parse()

