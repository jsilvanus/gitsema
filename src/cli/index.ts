import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { applyConfigToEnv } from '../core/config/configManager.js'
import {
  configSetCommand,
  configGetCommand,
  configListCommand,
  configUnsetCommand,
} from './commands/config.js'
import { statusCommand } from './commands/status.js'
import { indexCommand } from './commands/index.js'
import { searchCommand } from './commands/search.js'
import { codeSearchCommand } from './commands/codeSearch.js'
import { reposCommand } from './commands/repos.js'
import { lspCommand } from './commands/lsp.js'
import { securityScanCommand } from './commands/securityScan.js'
import { healthCommand } from './commands/health.js'
import { debtCommand } from './commands/debt.js'
import { firstSeenCommand } from './commands/firstSeen.js'
import { evolutionCommand } from './commands/evolution.js'
import { conceptEvolutionCommand } from './commands/conceptEvolution.js'
import { diffCommand } from './commands/diff.js'
import { semanticDiffCommand } from './commands/semanticDiff.js'
import { startMcpServer } from '../mcp/server.js'
import { backfillFtsCommand } from './commands/backfillFts.js'
import { updateModulesCommand } from './commands/updateModules.js'
import { runGarbageCollection } from '../core/indexing/gc.js'
import { serveCommand } from './commands/serve.js'
import { remoteIndexCommand } from './commands/remoteIndex.js'
import { semanticBlameCommand } from './commands/semanticBlame.js'
import { deadConceptsCommand } from './commands/deadConcepts.js'
import { impactCommand } from './commands/impact.js'
import { clustersCommand } from './commands/clusters.js'
import { clearModelCommand } from './commands/clearModel.js'
import { buildVssCommand } from './commands/buildVss.js'
import { clusterDiffCommand } from './commands/clusterDiff.js'
import { clusterTimelineCommand } from './commands/clusterTimeline.js'
import { changePointsCommand } from './commands/changePoints.js'
import { fileChangePointsCommand } from './commands/fileChangePoints.js'
import { clusterChangePointsCommand } from './commands/clusterChangePoints.js'
import { mergeAuditCommand } from './commands/mergeAudit.js'
import { branchSummaryCommand } from './commands/branchSummary.js'
import { mergePreviewCommand } from './commands/mergePreview.js'
import { authorCommand } from './commands/author.js'
import { semanticBisectCommand } from './commands/semanticBisect.js'
import { refactorCandidatesCommand } from './commands/refactorCandidates.js'
import { ciDiffCommand } from './commands/ciDiff.js'
import { conceptLifecycleCommand } from './commands/conceptLifecycle.js'
import { docGapCommand } from './commands/docGap.js'
import { contributorProfileCommand } from './commands/contributorProfile.js'
import { cherryPickSuggestCommand } from './commands/cherryPickSuggest.js'
import { mapCommand } from './commands/map.js'
import { heatmapCommand } from './commands/heatmap.js'
import { doctorCommand } from './commands/doctor.js'
import { vacuumCommand } from './commands/vacuum.js'
import { rebuildFtsCliCommand } from './commands/rebuildFts.js'
import { watchCommand } from './commands/watch.js'
import { exportIndex, importIndex } from './commands/bundleIndex.js'
import { projectCommand } from './commands/project.js'
import { toolsCommand } from './commands/tools.js'
import { expertsCommand } from './commands/experts.js'
import { prReportCommand } from './commands/prReport.js'
import { evalCommand } from './commands/eval.js'

const program = new Command()

// Accept a top-level `--verbose` flag so Commander does not reject it.
program.option('--verbose', 'Enable verbose debug logging')

// Honor `--verbose` early by setting an env var so other modules (logger)
// pick it up when they load.
if (process.argv.includes('--verbose')) process.env.GITSEMA_VERBOSE = '1'

// Apply file-based config defaults to process.env so all commands that read
// env vars transparently pick up values from .gitsema/config.json or
// ~/.config/gitsema/config.json.  Env vars already set take precedence.
// This mirrors the --verbose pattern above: both run eagerly before any
// command handler to ensure a consistent environment at parse time.
// The CLI entry point is never imported as a library — it's always run
// as the main script — so this side effect is safe here.
applyConfigToEnv()

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
  'Protocol Servers',
  'Search & Discovery',
  'File History',
  'Concept History',
  'Cluster Analysis',
  'Change Detection',
  'Code Quality',
  'Workflow & CI',
  'Repo Insights',
  'Visualization',
  'Maintenance',
] as const

const COMMAND_GROUPS: Record<string, string> = {
  // Setup & Infrastructure
  config:           'Setup & Infrastructure',
  status:           'Setup & Infrastructure',
  index:            'Setup & Infrastructure',
  'remote-index':   'Setup & Infrastructure',
  'backfill-fts':   'Setup & Infrastructure',
  'update-modules': 'Setup & Infrastructure',
  'build-vss':      'Setup & Infrastructure',
  // Protocol Servers (new group — preferred entry point is `gitsema tools`)
  // serve/mcp/lsp are hidden from top-level help; use `gitsema tools` instead
  tools:            'Protocol Servers',
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
  author:              'Concept History',
  // Cluster Analysis
  clusters:           'Cluster Analysis',
  'cluster-diff':     'Cluster Analysis',
  'cluster-timeline': 'Cluster Analysis',
  'branch-summary':   'Cluster Analysis',
  'merge-audit':      'Cluster Analysis',
  'merge-preview':    'Cluster Analysis',
  // Change Detection
  'change-points':         'Change Detection',
  'file-change-points':    'Change Detection',
  'cluster-change-points': 'Change Detection',
  // Code Quality
  'code-search':         'Code Quality',
  'security-scan':       'Code Quality',
  health:                'Code Quality',
  debt:                  'Code Quality',
  'doc-gap':             'Code Quality',
  'refactor-candidates': 'Code Quality',
  lifecycle:             'Code Quality',
  // Workflow & CI
  bisect:                  'Workflow & CI',
  'ci-diff':               'Workflow & CI',
  'contributor-profile':   'Workflow & CI',
  'cherry-pick-suggest':   'Workflow & CI',
  repos:                   'Workflow & CI',
  watch:                   'Workflow & CI',
  // Repo Insights
  experts:                 'Repo Insights',
  // Visualization
  map:     'Visualization',
  heatmap: 'Visualization',
  project: 'Visualization',
  // Maintenance
  doctor:        'Maintenance',
  vacuum:        'Maintenance',
  'rebuild-fts': 'Maintenance',
  gc:            'Maintenance',
  'clear-model': 'Maintenance',
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
  .command('config <action> [key] [value]')
  .description('Manage persistent configuration (set, get, list, unset)')
  .option('--global', 'apply to global config (~/.config/gitsema/config.json)')
  .option('--local', 'apply to local config (.gitsema/config.json, default for set/unset)')
  .addHelpText(
    'after',
    `
Subcommands:
  set <key> <value>   Set a config value (--global for user-level, default: repo-level)
  get <key>           Show the resolved value and its source
  list                List all active configuration values and their sources
  unset <key>         Remove a key from config (--global for user-level, default: repo-level)

Supported keys (dot-notation for command defaults):
  provider, model, textModel, codeModel, httpUrl, apiKey
  verbose, logMaxBytes, servePort, serveKey, remoteUrl, remoteKey
  index.concurrency, index.chunker, index.ext, index.maxSize, index.exclude
  index.maxCommits, index.windowSize, index.overlap
  search.top, search.hybrid, search.bm25Weight, search.recent
  search.weightVector, search.weightRecency, search.weightPath
  evolution.threshold, clusters.k
  hooks.enabled        (true/false — installs/removes Git post-commit/post-merge hooks)
  vscode.mcp           (true/false — installs/removes gitsema MCP server entry in mcp.json)
  vscode.lsp           (true/false — installs/removes gitsema LSP config in settings.json)

Examples:
  gitsema config set search.hybrid true
  gitsema config set provider http --global
  gitsema config set model text-embedding-3-small --global
  gitsema config get search.hybrid
  gitsema config list
  gitsema config unset search.hybrid`,
  )
  .action(
    async (
      action: string,
      key: string | undefined,
      value: string | undefined,
      options: { global?: boolean; local?: boolean },
    ) => {
      switch (action) {
        case 'set':
          if (!key) {
            console.error('Error: key is required for config set')
            process.exit(1)
          }
          if (value === undefined) {
            console.error('Error: value is required for config set')
            process.exit(1)
          }
          await configSetCommand(key as string, value as string, options)
          break
        case 'get':
          if (!key) {
            console.error('Error: key is required for config get')
            process.exit(1)
          }
          await configGetCommand(key as string)
          break
        case 'list':
          await configListCommand(options)
          break
        case 'unset':
          if (!key) {
            console.error('Error: key is required for config unset')
            process.exit(1)
          }
          await configUnsetCommand(key as string, options)
          break
        default:
          console.error(`Error: unknown config action '${action}'. Use: set, get, list, unset`)
          process.exit(1)
      }
    },
  )

program
  .command('status [file]')
  .description('Show index status and database info, or status for a specific file')
  .option('--remote <url>', 'remote server URL (overrides GITSEMA_REMOTE)')
  .action(statusCommand)

program
  .command('index')
  .description('Walk Git history and embed all blobs into the semantic index')
  .addHelpText(
    'after',
    '\nDefault mode is INCREMENTAL: automatically resumes from the last indexed commit.\n' +
    'Use --since all to force a full re-index from scratch.\n\n' +
    'Progress output shows: stage (collecting/embedding/commit-mapping), % complete,\n' +
    'throughput (blobs/s), embedding latency (avg + p95), and ETA.\n' +
    'A final summary prints per-stage timings and totals.\n\n' +
    'Performance tuning tips:\n' +
    '  - Increase --concurrency if your embedding server supports parallel requests\n' +
    '  - Use --chunker fixed with a smaller --window-size if you hit context-length errors\n' +
    '  - Use --ext to limit indexed file types (e.g. ".ts,.py") and reduce noise\n' +
    '  - Use --exclude node_modules,dist to skip irrelevant paths\n' +
    '  - Run `gitsema doctor` after indexing to verify index health'
  )
  .option(
    '--since <ref>',
    'resume from this point (date like 2024-01-01, tag, or commit hash); default: last indexed commit (incremental); use "all" to force full re-index',
  )
  .option(
    '--max-commits <n>',
    'stop after indexing this many commits; useful to split large histories into multiple incremental sessions',
  )
  .option(
    '--concurrency <n>',
    'parallel embedding calls (default 4); increase for faster remote providers, decrease if you hit rate-limit errors',
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
    '--include-glob <patterns>',
    'only index files matching these comma-separated glob patterns, e.g. "src/**/*.ts,tests/**"',
  )
  .option(
    '--chunker <strategy>',
    'chunking strategy: file (default, one embedding per file), function (function/class boundaries), fixed (fixed-size windows with overlap)',
  )
  .option(
    '--window-size <n>',
    'target chunk size in characters for the fixed chunker (default 1500); reduce if you hit context-length errors',
  )
  .option(
    '--overlap <n>',
    'overlap in characters between adjacent fixed chunks (default 200)',
  )
  .option(
    '--embed-batch-size <n>',
    'number of texts per embedBatch() call for HTTP providers with --chunker file (default 1; try 32-64 for local HTTP)',
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
  .option('--model <model>', 'override embedding model for this run')
  .option('--text-model <model>', 'override text/prose embedding model')
  .option('--code-model <model>', 'override source-code embedding model (defaults to text model)')
  .option('--quantize', 'store embeddings as int8-quantized vectors (4× smaller, ~1% recall loss)')
  .option('--build-vss', 'build a usearch HNSW ANN index after indexing completes (requires usearch package)')
  .option('--auto-build-vss [threshold]', 'automatically build VSS index after indexing when blob count exceeds threshold (default: 10000)')
  .option('--allow-mixed', 'allow indexing with a different embed config than previously used (skip compatibility check)')
  .option('--profile <name>', 'apply a preset profile: speed (high concurrency, large batches), balanced (default), quality (deep chunking)')
  .action(indexCommand)

// index export / index import — Phase 54 subcommands
// (export-index and import-index top-level aliases kept for backward compatibility)

const indexSub = program.commands.find((c) => c.name() === 'index')!

indexSub
  .command('export')
  .description('Export the index as a compressed bundle (tar.gz) for sharing or backup')
  .option('--out <file>', 'output bundle file path', 'gitsema-index.tar.gz')
  .option('--after <date>', 'only include metadata for blobs first seen after this date (YYYY-MM-DD, tag, or commit)')
  .option('--since <ref>', 'alias for --after')
  .action(async (opts: { out: string; after?: string; since?: string }) => {
    await exportIndex(opts)
  })

indexSub
  .command('import')
  .description('Import a gitsema index bundle (tar.gz) into the current .gitsema/ directory')
  .option('--in <file>', 'input bundle file path', 'gitsema-index.tar.gz')
  .action(async (opts: { in: string }) => {
    await importIndex(opts)
  })

// Backward-compatible top-level aliases
program
  .command('export-index', { hidden: true })
  .description('[alias] gitsema index export')
  .option('--out <file>', 'output bundle file path', 'gitsema-index.tar.gz')
  .option('--after <date>', 'only include metadata for blobs first seen after this date')
  .option('--since <ref>', 'alias for --after')
  .action(async (opts: { out: string; after?: string; since?: string }) => {
    await exportIndex(opts)
  })

program
  .command('import-index', { hidden: true })
  .description('[alias] gitsema index import')
  .option('--in <file>', 'input bundle file path', 'gitsema-index.tar.gz')
  .action(async (opts: { in: string }) => {
    await importIndex(opts)
  })

program
  .command('doctor')
  .description('Run integrity checks, schema version/provenance checks, and report index health')
  .option('--lsp', 'only run the LSP startup check (gitsema doctor --lsp)')
  .action(async (opts: { lsp?: boolean }) => {
    await doctorCommand(opts)
  })

program
  .command('vacuum')
  .description('VACUUM and ANALYZE the SQLite index database to reduce size and improve performance')
  .action(async () => {
    await vacuumCommand()
  })

program
  .command('rebuild-fts')
  .description('Rebuild the FTS5 full-text search index from stored data')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (opts: { yes?: boolean }) => {
    await rebuildFtsCliCommand({ yes: opts.yes })
  })

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
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .option('--not-like <query>', 'negative example query whose similarity is subtracted from the score')
  .option('--lambda <n>', 'weight for the negative example subtraction (default 0.5)')
  .option('--explain', 'show score component breakdown for each result')
  .option('--early-cut <n>', 'limit candidate pool to n random samples to speed up search on large indexes')
  .option('--explain-llm', 'output LLM-ready provenance citation block for each result')
  .option('--html [file]', 'output interactive HTML; writes to <file> if given, otherwise search.html')
  .option('--or <query>', 'combine results with OR (union, max score)')
  .option('--and <query>', 'combine results with AND (intersection, harmonic mean)')
  .option('--expand-query', 'expand query with top BM25 keywords before embedding to improve recall (Phase 52)')
  .option('--narrate', 'generate an LLM summary of search results (requires GITSEMA_LLM_URL)')
  .option('--repos <ids>', 'comma-separated repo IDs to include in search (multi-repo; use gitsema repos add to register)')
  .option('--no-headings', "don't print column header row")
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

program
  .command('first-seen <query>')
  .description('Find when a concept first appeared in the codebase, sorted by date (see also: search, concept-evolution)')
  .option('-k, --top <n>', 'number of results to return', '10')
  .option('--branch <name>', 'restrict results to blobs seen on this branch')
  .option('--no-headings', "don't print header row")
  .option('--hybrid', 'blend vector similarity with BM25 keyword matching (requires prior backfill-fts)')
  .option('--bm25-weight <n>', 'BM25 weight in hybrid score (default 0.3)', '0.3')
  .option('--include-commits', 'also search commit messages and show chronological commit results')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .option('--remote <url>', 'proxy to a remote gitsema server (overrides GITSEMA_REMOTE)')
  .option('--vss', 'use the usearch HNSW ANN index for approximate search (requires prior `gitsema build-vss`; falls back to linear scan)')
  .option('--html [file]', 'output interactive HTML; writes to <file> if given, otherwise first-seen.html')
  .option('--repos <ids>', 'comma-separated repo IDs to include in search (multi-repo)')
  .action(firstSeenCommand)

program
  .command('file-evolution <path>')
  .description('Track semantic drift of a file over its Git history (see also: file-diff, evolution)')
  .option(
    '--threshold <n>',
    'cosine distance threshold above which a version change is flagged as a large change (default 0.3)',
  )
  .option('--level <level>', 'embedding level: file (default) or symbol — symbol uses per-symbol centroid embeddings')
  .option(
    '--dump [file]',
    'output structured JSON of all evolution entries; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise file-evolution.html',
  )
  .option(
    '--include-content',
    'include the stored file content for each version in the JSON dump (only used with --dump)',
  )
  .option(
    '--alerts [n]',
    'show the top-N largest semantic jumps (default 5) with author and commit link; use with --dump to include in JSON output',
  )
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--remote <url>', 'proxy to a remote gitsema server (overrides GITSEMA_REMOTE)')
  .option('--narrate', 'generate an LLM narrative summary of semantic shifts (requires GITSEMA_LLM_URL)')
  .option('--no-headings', "don't print column header row")
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
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--branch <name>', 'restrict evolution to blobs seen on this branch')
  .option('--remote <url>', 'proxy to a remote gitsema server (overrides GITSEMA_REMOTE)')
  .option('--narrate', 'generate an LLM summary of concept evolution results (requires GITSEMA_LLM_URL)')
  .option('--no-headings', "don't print column header row")
  .action(conceptEvolutionCommand)

program
  .command('bisect <good> <bad> <query>')
  .description('Semantic git bisect — binary search over commit history to find where a concept diverged from a "good" baseline')
  .option('-k, --top <n>', 'top-K blobs to use for centroid at each step', '20')
  .option('--max-steps <n>', 'maximum bisect steps (default 10)', '10')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .action(semanticBisectCommand)

program
  .command('refactor-candidates')
  .description('Find pairs of symbols/chunks/files that are semantically similar enough to be refactoring candidates')
  .option('--threshold <n>', 'similarity threshold (default 0.88)', '0.88')
  .option('-k, --top <n>', 'max pairs to return (default 50)', '50')
  .option('--level <level>', 'search granularity: symbol (default), chunk, file', 'symbol')
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .option('--no-headings', "don't print report header")
  .action(refactorCandidatesCommand)

program
  .command('ci-diff')
  .description('CI/CD semantic diff — compare semantic content between two Git refs and exit non-zero when concepts changed')
  .option('--base <ref>', 'base ref to compare from (default HEAD~1)', 'HEAD~1')
  .option('--head <ref>', 'head ref to compare to (default HEAD)', 'HEAD')
  .option('--query <query>', 'semantic topic to focus on (default "semantic changes")', 'semantic changes')
  .option('-k, --top <n>', 'max blobs per diff group (default 20)', '20')
  .option('--format <fmt>', 'output format: text (default), html, json', 'text')
  .option('--threshold <n>', 'score threshold for significant changes (default 0.3)', '0.3')
  .option('--out <file>', 'output file path')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--github-token <token>', 'GitHub token to post diff as a PR review comment (overrides GITHUB_TOKEN)')
  .action(ciDiffCommand)

program
  .command('lifecycle <query>')
  .description('Analyze the lifecycle stages (born → growing → mature → declining → dead) of a semantic concept across Git history')
  .option('--steps <n>', 'number of time windows to sample (default 10)', '10')
  .option('--threshold <n>', 'cosine similarity threshold for "match" (default 0.7)', '0.7')
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--narrate', 'generate an LLM narrative of concept lifecycle (requires GITSEMA_LLM_URL)')
  .action(conceptLifecycleCommand)

program
  .command('doc-gap')
  .description('Find undocumented code by comparing code blobs against prose/documentation embeddings')
  .option('-k, --top <n>', 'number of results to return', '20')
  .option('--threshold <n>', 'only include code files whose max similarity to docs is below this threshold (0–1)')
  .option('--branch <name>', 'restrict to blobs seen on this branch')
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .action(docGapCommand)

program
  .command('contributor-profile <author>')
  .description('Compute a contributor semantic profile and show top-N blobs they specialize in')
  .option('-k, --top <n>', 'number of top results to return', '10')
  .option('--branch <name>', 'restrict to blobs seen on this branch')
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .action(contributorProfileCommand)

program
  .command('pr-report')
  .description('Compose a semantic PR report: diff, impacted modules, change-points, reviewer suggestions')
  .option('--ref1 <ref>', 'Base ref (default: HEAD~1)', 'HEAD~1')
  .option('--ref2 <ref>', 'Head ref (default: HEAD)', 'HEAD')
  .option('--file <path>', 'File path to analyze for semantic diff and impact')
  .option('--query <text>', 'Concept query for change-point highlights')
  .option('-k, --top <n>', 'Result limit', '10')
  .option('--since <date>', 'Filter reviewer activity since date (YYYY-MM-DD)')
  .option('--until <date>', 'Filter reviewer activity until date (YYYY-MM-DD)')
  .option('--dump [file]', 'Output JSON report; writes to file or stdout if no path given')
  .action(async (options) => {
    await prReportCommand(options)
  })

program
  .command('cherry-pick-suggest <query>')
  .description('Suggest commits to cherry-pick based on semantic similarity to a query')
  .option('-k, --top <n>', 'number of results to return', '10')
  .option('--model <model>', 'embedding model to use')
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .action(cherryPickSuggestCommand)

program
  .command('map')
  .description('Output a JSON representation of semantic clusters and blob assignments (semantic codebase map)')
  .action(async () => { await mapCommand() })

program
  .command('heatmap')
  .description('Show semantic activity heatmap — count of distinct blob changes by time period (week or month)')
  .option('--period <p>', 'aggregation period: week (default) or month', 'week')
  .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
  .option('--no-headings', "don't print column header row")
  .action(async (opts: { period?: string; dump?: string | boolean; noHeadings?: boolean }) => { await heatmapCommand({ period: opts.period, dump: opts.dump, noHeadings: opts.noHeadings }) })

program
  .command('file-diff <ref1> <ref2> <path>')
  .description('Compute semantic diff between two versions of a file (see also: file-evolution, cluster-diff, diff)')
  .option(
    '--neighbors <n>',
    'number of nearest-neighbour blobs to show for each version (default 0)',
  )
  .option('--narrate', 'generate an LLM narrative interpretation of the semantic diff (requires GITSEMA_LLM_URL)')
  .action(diffCommand)

program
  .command('diff <ref1> <ref2> <query>')
  .description('Compute a conceptual/semantic diff of a topic across two git refs — shows gained, lost, and stable concepts (see also: file-diff, evolution)')
  .option('-k, --top <n>', 'max results to show per group (gained/lost/stable)', '10')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--branch <name>', 'restrict blobs to those seen on this branch')
  .option('--hybrid', 'blend vector similarity with BM25 keyword matching')
  .option('--bm25-weight <n>', 'BM25 weight in hybrid score (default 0.3)', '0.3')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise semantic-diff.html',
  )
  .action(semanticDiffCommand)

program
  .command('serve', { hidden: true })
  .description('Start the gitsema HTTP API server [deprecated: use `gitsema tools serve`]')
  .option('--port <n>', 'port to listen on (default 4242, overrides GITSEMA_SERVE_PORT)')
  .option('--key <token>', 'require this Bearer token for all requests (overrides GITSEMA_SERVE_KEY)')
  .option(
    '--chunker <strategy>',
    'chunking strategy for incoming blobs: file (default), function, fixed',
  )
  .option('--concurrency <n>', 'max concurrent embedding calls (default 4)')
  .option('--ui', 'serve the embedding space explorer web UI at /ui (requires prior `gitsema project` run)')
  .action(async (opts: Parameters<typeof serveCommand>[0]) => {
    console.warn('Deprecation notice: `gitsema serve` is deprecated — use `gitsema tools serve` instead.')
    await serveCommand(opts)
  })

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
  .option('--level <level>', 'search level: file (default) or symbol — symbol uses function-level embeddings')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--branch <name>', 'restrict neighbor search to blobs seen on this branch')
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
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise dead-concepts.html',
  )
  .option('--branch <name>', 'restrict dead-concept candidates to blobs seen on this branch')
  .option('--no-headings', "don't print section header")
  .action(deadConceptsCommand)

program
  .command('impact <path>')
  .description('Compute semantically similar blobs across the codebase to highlight refactor impact (see also: blame, file-diff)')
  .option('-k, --top <n>', 'number of similar blobs to return', '10')
  .option('--chunks', 'include chunk-level embeddings for finer-grained coupling')
  .option('--level <level>', 'search level: file (default), chunk, or symbol')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--branch <name>', 'restrict results to blobs seen on this branch')
  .option('--html [file]', 'output interactive HTML; writes to <file> if given, otherwise impact.html')
  .option('--no-headings', "don't print section header")
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
  .option('--branch <name>', 'restrict clustering to blobs seen on this branch')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--narrate', 'generate an LLM summary of cluster structure (requires GITSEMA_LLM_URL)')
  .option('--no-headings', "don't print summary header")
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
  .option('--branch <name>', 'restrict clustering to blobs seen on this branch at each ref')
  .option('--narrate', 'generate an LLM narrative of the cluster diff (requires GITSEMA_LLM_URL)')
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
  .option('--branch <name>', 'restrict cluster snapshots to blobs seen on this branch')
  .option('--narrate', 'generate an LLM narrative of the cluster timeline (requires GITSEMA_LLM_URL)')
  .action(clusterTimelineCommand)

program
  .command('change-points <query>')
  .description('Detect conceptual change points for a semantic query across commit history (see also: concept-evolution, cluster-change-points)')
  .option('-k, --top <n>', 'number of top-matching blobs used to define concept state per commit (default 50)', '50')
  .option('--threshold <n>', 'cosine distance threshold to flag a change point (default 0.3)', '0.3')
  .option('--top-points <n>', 'show top-N largest shifts (default 5)', '5')
  .option('--since <ref>', 'limit commits from this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option('--until <ref>', 'limit commits up to this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--hybrid', 'blend vector similarity with BM25 keyword matching')
  .option('--bm25-weight <n>', 'BM25 weight in hybrid score (default 0.3)', '0.3')
  .option('--branch <name>', 'restrict concept state to blobs seen on this branch')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise change-points.html',
  )
  .option('--narrate', 'generate an LLM narrative of change points (requires GITSEMA_LLM_URL)')
  .option('--no-headings', "don't print report header")
  .action(changePointsCommand)

program
  .command('file-change-points <path>')
  .description('Detect semantic change points in a file\'s Git history (see also: file-evolution, change-points)')
  .option('--threshold <n>', 'cosine distance threshold to flag a change point (default 0.3)', '0.3')
  .option('--top-points <n>', 'show top-N largest shifts (default 5)', '5')
  .option('--level <level>', 'embedding level: file (default) or symbol — symbol uses per-symbol centroid embeddings')
  .option('--branch <name>', 'restrict to blobs seen on this branch')
  .option('--since <ref>', 'limit commits from this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option('--until <ref>', 'limit commits up to this point; accepts a date (YYYY-MM-DD), tag, or commit hash')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise file-change-points.html',
  )
  .option('--narrate', 'generate an LLM narrative of file change points (requires GITSEMA_LLM_URL)')
  .option('--no-headings', "don't print report header")
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
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise cluster-change-points.html',
  )
  .option('--enhanced-labels', 'enhance cluster labels using TF-IDF path and identifier analysis')
  .option('--enhanced-keywords-n <n>', 'number of enhanced keywords to compute per cluster (default 5)', '5')
  .option('--branch <name>', 'restrict cluster snapshots to blobs seen on this branch')
  .action(clusterChangePointsCommand)

program
  .command('branch-summary <branch>')
  .description('Generate a semantic summary of what a branch is about compared to its base branch (see also: merge-audit, merge-preview)')
  .option('--base <branch>', 'base branch to compare against (default: main)')
  .option('-k, --top <n>', 'number of nearest concept clusters to show (default 5)', '5')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise branch-summary.html',
  )
  .option('--enhanced-labels', 'show more keyword detail for concept clusters in the output')
  .option('--enhanced-keywords-n <n>', 'number of keywords to display per cluster when --enhanced-labels is set (default 8)', '8')
  .action(branchSummaryCommand)

program
  .command('merge-audit <branch-a> <branch-b>')
  .description('Detect semantic collisions between two branches — concept-level conflicts that textual diff cannot find (see also: branch-summary, merge-preview)')
  .option(
    '--base <commit>',
    'override merge-base detection with this commit hash or ref',
  )
  .option(
    '--threshold <n>',
    'cosine similarity threshold for a collision (0–1, default 0.85)',
    '0.85',
  )
  .option('-k, --top <n>', 'max collision pairs to display (default 20)', '20')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML visualization; writes to <file> if given, otherwise merge-audit.html',
  )
  .option('--enhanced-labels', 'show top keywords alongside cluster labels in collision output')
  .action(mergeAuditCommand)

program
  .command('merge-preview <branch>')
  .description('Predict semantic cluster shifts that will occur after merging a branch — merge impact analysis (see also: merge-audit, cluster-diff)')
  .option('--into <branch>', 'target branch to merge into (default: main)')
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
    'output an interactive HTML visualization; writes to <file> if given, otherwise merge-preview.html',
  )
  .option('--enhanced-labels', 'enhance cluster labels using TF-IDF path and identifier analysis')
  .option('--enhanced-keywords-n <n>', 'number of enhanced keywords to compute per cluster (default 5)', '5')
  .action(mergePreviewCommand)

program
  .command('backfill-fts')
  .description('Populate FTS5 content for blobs indexed before Phase 11 (enables hybrid search and --include-content)')
  .action(async () => {
    await backfillFtsCommand()
  })

program
  .command('update-modules')
  .description('Recalculate module (directory) centroid embeddings from stored whole-file embeddings')
  .option('--verbose', 'enable verbose output')
  .action(async (opts) => {
    await updateModulesCommand({ verbose: opts.verbose })
  })

program
  .command('gc')
  .description('Garbage collect unreachable blob records from the DB')
  .option('--dry-run', 'only report what would be removed')
  .option('--verbose', 'print verbose output')
  .action(async (opts: { dryRun?: boolean; verbose?: boolean }) => {
    try {
      const stats = await runGarbageCollection({ dryRun: !!opts.dryRun })
      console.log(`Total blobs: ${stats.total}; unreachable: ${stats.removed}`)
      if (!opts.dryRun) console.log(`Removed ${stats.removed} unreachable blobs`)
    } catch (err) {
      console.error(`GC failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  })

program
  .command('clear-model <model>')
  .description('Delete all stored embeddings and cache entries for a specific model')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (model, opts) => {
    await clearModelCommand(model, { yes: opts.yes })
  })

program
  .command('build-vss', { hidden: true })
  .description('Build a usearch HNSW ANN index from stored embeddings for fast approximate search (requires usearch package)')
  .option('--model <model>', 'build index for this model (default: configured text model)')
  .option('--ef-construction <n>', 'HNSW ef_construction parameter — higher = better recall, slower build (default 200)')
  .option('--M <n>', 'HNSW M parameter — number of connections per layer (default 16)')
  .action(async (opts) => {
    await buildVssCommand({
      model: opts.model,
      efConstruction: opts.efConstruction,
      M: opts.M,
    })
  })

program
  .command('mcp', { hidden: true })
  .description('Start the gitsema MCP server (stdio transport) [deprecated: use `gitsema tools mcp`]')
  .action(async () => {
    console.warn('Deprecation notice: `gitsema mcp` is deprecated — use `gitsema tools mcp` instead.')
    await startMcpServer()
  })

program
  .command('author <query>')
  .description('Rank authors by semantic contribution to a concept (see also: search, evolution)')
  .option('-k, --top <n>', 'number of top authors to return (default 10)', '10')
  .option('--since <date>', 'only consider contributions since this date (YYYY-MM-DD)')
  .option('--detail', 'show the specific files and commits that contributed to each author\'s ranking')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option('--branch <name>', 'restrict concept attribution to blobs seen on this branch')
  .option('--model <model>', 'override embedding model')
  .option('--text-model <model>', 'override text embedding model')
  .option('--code-model <model>', 'override code embedding model')
  .option('--include-commits', 'also search commit messages for author attribution')
  .option('--chunks', 'include chunk-level embeddings for finer-grained attribution')
  .option('--level <level>', 'search level: file (default), chunk, or symbol')
  .option('--hybrid', 'use hybrid (vector + BM25) search to find initial candidate blobs')
  .option('--bm25-weight <n>', 'BM25 weight in hybrid score (default 0.3)', '0.3')
  .option('--vss', 'use the usearch HNSW ANN index for approximate candidate selection')
  .option('--html [file]', 'output interactive HTML; writes to <file> if given, otherwise author.html')
  .option('--no-headings', "don't print query title header")
  .action(authorCommand)

program
  .command('project')
  .description('Compute 2D random projections of all embeddings for the web UI (requires prior `gitsema index`)')
  .option('--model <model>', 'embedding model to project (default: GITSEMA_MODEL)')
  .option('--limit <n>', 'max number of embeddings to project (default: 10000)')
  .action(async (opts: { model?: string; limit?: string }) => {
    await projectCommand(opts)
  })

program
  .command('experts')
  .description('Show top contributors ranked by blob count and the semantic areas they worked on (see also: author, contributor-profile)')
  .addHelpText(
    'after',
    '\nNo embedding provider required — uses data already in the index.\n' +
    'Run `gitsema clusters` first to get richer semantic-area labels.\n\n' +
    'Examples:\n' +
    '  gitsema experts                         # top 10 contributors overall\n' +
    '  gitsema experts --top 5 --since 2024-01-01  # top 5 in 2024\n' +
    '  gitsema experts --dump experts.json     # export to JSON\n' +
    '  gitsema experts --html experts.html     # interactive HTML report',
  )
  .option('--top <n>', 'number of top contributors to show (default 10)', '10')
  .option(
    '--since <ref>',
    'only count commits at or after this date or ISO 8601 timestamp (e.g. 2024-01-01)',
  )
  .option(
    '--until <ref>',
    'only count commits at or before this date or ISO 8601 timestamp (e.g. 2024-12-31)',
  )
  .option('--min-blobs <n>', 'suppress contributors with fewer than this many blobs (default 1)', '1')
  .option('--top-clusters <n>', 'max semantic areas to show per contributor (default 5)', '5')
  .option(
    '--dump [file]',
    'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout',
  )
  .option(
    '--html [file]',
    'output an interactive HTML report; writes to <file> if given, otherwise experts.html',
  )
  .action(async (opts: Parameters<typeof expertsCommand>[0]) => {
    await expertsCommand(opts)
  })

// ─────────────────────────────────────────────────────────────────────────────
// Phase 64: gitsema eval — retrieval evaluation harness
// ─────────────────────────────────────────────────────────────────────────────
program
  .command('eval <file>')
  .description('Evaluate retrieval quality against a JSONL file of (query, expectedPaths) pairs.')
  .option('-k, --top <n>', 'retrieve top-k results per query (default: 10)')
  .option('--dump [file]', 'write full JSON results to <file> (or stdout if no file given)')
  .action(async (file: string, opts: { top?: string; dump?: string | boolean }) => {
    await evalCommand({ file, ...opts })
  })

program.parse()

