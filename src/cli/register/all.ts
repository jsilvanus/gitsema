import { Command } from 'commander'
import { collectOut } from '../../utils/outputSink.js'

// Per-domain register helpers (keep existing split modules available)
import { registerSetup } from './setup.js'
import { registerIndexing } from './indexing.js'
import { registerSearch } from './search.js'
import { registerAnalysis } from './analysis.js'

// Command handlers (moved from src/cli/index.ts)
import { conceptEvolutionCommand } from '../commands/conceptEvolution.js'
import { semanticBisectCommand } from '../commands/semanticBisect.js'
import { refactorCandidatesCommand } from '../commands/refactorCandidates.js'
import { ciDiffCommand } from '../commands/ciDiff.js'
import { conceptLifecycleCommand } from '../commands/conceptLifecycle.js'
import { docGapCommand } from '../commands/docGap.js'
import { contributorProfileCommand } from '../commands/contributorProfile.js'
import { prReportCommand } from '../commands/prReport.js'
import { triageCommand } from '../commands/triage.js'
import { policyCheckCommand } from '../commands/policyCheck.js'
import { ownershipCommand } from '../commands/ownership.js'
import { workflowCommand, workflowListCommand } from '../commands/workflow.js'
import { cherryPickSuggestCommand } from '../commands/cherryPickSuggest.js'
import { mapCommand } from '../commands/map.js'
import { heatmapCommand } from '../commands/heatmap.js'
import { diffCommand } from '../commands/diff.js'
import { semanticDiffCommand } from '../commands/semanticDiff.js'
import { serveCommand } from '../commands/serve.js'
import { remoteIndexCommand } from '../commands/remoteIndex.js'
import { semanticBlameCommand } from '../commands/semanticBlame.js'
import { deadConceptsCommand } from '../commands/deadConcepts.js'
import { impactCommand } from '../commands/impact.js'
import { clustersCommand } from '../commands/clusters.js'
import { clusterDiffCommand } from '../commands/clusterDiff.js'
import { clusterTimelineCommand } from '../commands/clusterTimeline.js'
import { changePointsCommand } from '../commands/changePoints.js'
import { fileChangePointsCommand } from '../commands/fileChangePoints.js'
import { clusterChangePointsCommand } from '../commands/clusterChangePoints.js'
import { branchSummaryCommand } from '../commands/branchSummary.js'
import { mergeAuditCommand } from '../commands/mergeAudit.js'
import { mergePreviewCommand } from '../commands/mergePreview.js'
import { startMcpServer } from '../../mcp/server.js'
import { authorCommand } from '../commands/author.js'
import { projectCommand } from '../commands/project.js'
import { expertsCommand } from '../commands/experts.js'
import { evalCommand } from '../commands/eval.js'
import { replCommand } from '../commands/repl.js'
import { quickstartCommand } from '../commands/quickstart.js'
import { regressionGateCommand } from '../commands/regressionGate.js'
import { crossRepoSimilarityCommand } from '../commands/crossRepoSimilarity.js'
import { codeReviewCommand } from '../commands/codeReview.js'

export function registerAll(program: Command) {
  // Preserve per-domain registration modules
  registerSetup(program)
  registerIndexing(program)
  registerSearch(program)
  registerAnalysis(program)

  // Concept evolution / concept-level timeline
  program
    .command('evolution <query>')
    .description('Trace how a semantic concept evolved across the entire codebase history.')
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
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
    .action(semanticBisectCommand)

  program
    .command('refactor-candidates')
    .description('Find pairs of symbols/chunks/files that are semantically similar enough to be refactoring candidates')
    .option('--threshold <n>', 'similarity threshold (default 0.88)', '0.88')
    .option('-k, --top <n>', 'max pairs to return (default 50)', '50')
    .option('--level <level>', 'search granularity: symbol (default), chunk, file', 'symbol')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
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
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
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
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
    .action(docGapCommand)

  program
    .command('contributor-profile <author>')
    .description('Compute a contributor semantic profile and show top-N blobs they specialize in')
    .option('-k, --top <n>', 'number of top results to return', '10')
    .option('--branch <name>', 'restrict to blobs seen on this branch')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
    .action(contributorProfileCommand)

  // Many analysis commands are already registered by registerAnalysis; avoid duplicates

  program
    .command('workflow run <template>')
    .description(
      'Run a productized workflow pattern (use `workflow list` to see all 8 patterns).\n' +
      'Patterns: pr-review, release-audit, onboarding, incident, ownership-intel, arch-drift, knowledge-portal, regression-forecast'
    )
    .option('--dump [file]', 'output structured JSON; writes to <file> if given (legacy: prefer --out json)')
    .option('--format <fmt>', 'output format: markdown (default) or json — legacy; prefer --out', 'markdown')
    .option('--base <ref>', 'base ref for pr-review')
    .option('--file <path>', 'file to analyze (pr-review)')
    .option('--query <text>', 'concept query (incident, onboarding, ownership-intel, knowledge-portal, regression-forecast)')
    .option('--role <topic>', 'role/topic for onboarding pattern (e.g. auth, billing, frontend); alias for --query')
    .option('--ref <git-ref>', 'base git ref for regression-forecast comparison')
    .option('-k, --top <n>', 'result limit', '5')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|markdown[:file] (overrides --dump/--format)', collectOut, [] as string[])
    .action(async (template: string, args: string[], opts: any) => {
      await workflowCommand(template, args, {
        dump: opts.dump,
        format: opts.format,
        base: opts.base,
        file: opts.file,
        query: opts.query,
        role: opts.role,
        ref: opts.ref,
        top: opts.top,
        out: opts.out,
      })
    })

  program
    .command('workflow list')
    .description('List all 8 productized workflow patterns with descriptions')
    .action(workflowListCommand)

  program
    .command('cherry-pick-suggest <query>')
    .description('Suggest commits to cherry-pick based on semantic similarity to a query')
    .option('-k, --top <n>', 'number of results to return', '10')
    .option('--model <model>', 'embedding model to use')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
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
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
    .option('--no-headings', "don't print column header row")
    .action(async (opts: { period?: string; dump?: string | boolean; noHeadings?: boolean }) => { await heatmapCommand({ period: opts.period, dump: opts.dump, noHeadings: opts.noHeadings }) })

  program
    .command('file-diff <ref1> <ref2> <path>')
    .description('Compute semantic diff between two versions of a file (see also: file-evolution, cluster-diff, diff)')
    .option('--neighbors <n>', 'number of nearest-neighbour blobs to show for each version (default 0)')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise semantic-diff.html')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
    .action(semanticDiffCommand)

  // Hidden top-level aliases for backward compatibility
  program
    .command('serve', { hidden: true })
    .description('Start the gitsema HTTP API server [deprecated: use `gitsema tools serve`]')
    .option('--port <n>', 'port to listen on (default 4242, overrides GITSEMA_SERVE_PORT)')
    .option('--key <token>', 'require this Bearer token for all requests (overrides GITSEMA_SERVE_KEY)')
    .option('--chunker <strategy>', 'chunking strategy for incoming blobs: file (default), function, fixed')
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
    .option('--since <ref>', 'only index commits after this point; accepts a date, tag, commit hash, or "all"')
    .option('--max-commits <n>', 'stop after indexing this many commits')
    .option('--concurrency <n>', 'parallel embedding workers on the server (default 4)')
    .option('--ext <extensions>', 'only index files with these comma-separated extensions')
    .option('--max-size <size>', 'skip blobs larger than this size, e.g. "200kb"')
    .option('--exclude <patterns>', 'skip blobs whose path contains these comma-separated patterns')
    .option('--chunker <strategy>', 'chunking strategy: file (default), function, fixed')
    .option('--window-size <n>', 'chunk size in characters for the fixed chunker (default 1500)')
    .option('--overlap <n>', 'character overlap between adjacent fixed chunks (default 200)')
    .option('--db-label <label>', 'route indexing to .gitsema/<label>.db on the server (1–64 alphanumeric chars or hyphens)')
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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .action(semanticBlameCommand)

  program
    .command('dead-concepts')
    .description('Find historical concepts no longer in HEAD but semantically similar to current code (see also: search, concept-evolution)')
    .option('-k, --top <n>', 'number of results to return', '10')
    .option('--since <date>', 'only consider dead blobs whose latest commit is on or after this date (YYYY-MM-DD or ISO 8601)')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise dead-concepts.html')
    .option('--branch <name>', 'restrict dead-concept candidates to blobs seen on this branch')
    .option('--no-headings', "don't print section header")
    .action(deadConceptsCommand)

  program
    .command('impact <path>')
    .description('Compute semantically similar blobs across the codebase to highlight refactor impact (see also: blame, file-diff)')
    .option('-k, --top <n>', 'number of similar blobs to return', '10')
    .option('--chunks', 'include chunk-level embeddings for finer-grained coupling')
    .option('--level <level>', 'search level: file (default), chunk, or symbol')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise clusters.html')
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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise cluster-diff.html')
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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise cluster-timeline.html')
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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise change-points.html')
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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise file-change-points.html')
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
    .option('--max-commits <n>', 'cap the number of commits evaluated (sampled evenly across the range); omit to evaluate every commit')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise cluster-change-points.html')
    .option('--enhanced-labels', 'enhance cluster labels using TF-IDF path and identifier analysis')
    .option('--enhanced-keywords-n <n>', 'number of enhanced keywords to compute per cluster (default 5)', '5')
    .option('--branch <name>', 'restrict cluster snapshots to blobs seen on this branch')
    .action(clusterChangePointsCommand)

  program
    .command('branch-summary <branch>')
    .description('Generate a semantic summary of what a branch is about compared to its base branch (see also: merge-audit, merge-preview)')
    .option('--base <branch>', 'base branch to compare against (default: main)')
    .option('-k, --top <n>', 'number of nearest concept clusters to show (default 5)', '5')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise branch-summary.html')
    .option('--enhanced-labels', 'show more keyword detail for concept clusters in the output')
    .option('--enhanced-keywords-n <n>', 'number of keywords to display per cluster when --enhanced-labels is set (default 8)', '8')
    .action(branchSummaryCommand)

  program
    .command('merge-audit <branch-a> <branch-b>')
    .description('Detect semantic collisions between two branches — concept-level conflicts that textual diff cannot find (see also: branch-summary, merge-preview)')
    .option('--base <commit>', 'override merge-base detection with this commit hash or ref')
    .option('--threshold <n>', 'cosine similarity threshold for a collision (0–1, default 0.85)', '0.85')
    .option('-k, --top <n>', 'max collision pairs to display (default 20)', '20')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise merge-audit.html')
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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML visualization; writes to <file> if given, otherwise merge-preview.html')
    .option('--enhanced-labels', 'enhance cluster labels using TF-IDF path and identifier analysis')
    .option('--enhanced-keywords-n <n>', 'number of enhanced keywords to compute per cluster (default 5)', '5')
    .action(mergePreviewCommand)

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
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
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
    .addHelpText('after', '\nNo embedding provider required — uses data already in the index.\nRun `gitsema clusters` first to get richer semantic-area labels.\n\nExamples:\n  gitsema experts                         # top 10 contributors overall\n  gitsema experts --top 5 --since 2024-01-01  # top 5 in 2024\n  gitsema experts --dump experts.json     # export to JSON\n  gitsema experts --html experts.html     # interactive HTML report')
    .option('--top <n>', 'number of top contributors to show (default 10)', '10')
    .option('--since <ref>', 'only count commits at or after this date or ISO 8601 timestamp (e.g. 2024-01-01)')
    .option('--until <ref>', 'only count commits at or before this date or ISO 8601 timestamp (e.g. 2024-12-31)')
    .option('--min-blobs <n>', 'suppress contributors with fewer than this many blobs (default 1)', '1')
    .option('--top-clusters <n>', 'max semantic areas to show per contributor (default 5)', '5')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given, otherwise prints JSON to stdout')
    .option('--html [file]', 'output an interactive HTML report; writes to <file> if given, otherwise experts.html')
    .action(async (opts: Parameters<typeof expertsCommand>[0]) => {
      await expertsCommand(opts)
    })

  // Eval / repl / quickstart / regression-gate / cross-repo / code-review handlers
  program
    .command('eval <file>')
    .description('Evaluate retrieval quality against a JSONL file of (query, expectedPaths) pairs.')
    .option('-k, --top <n>', 'retrieve top-k results per query (default: 10)')
    .option('--dump [file]', 'write full JSON results to <file> (or stdout if no file given)')
    .action(async (file: string, opts: { top?: string; dump?: string | boolean }) => {
      await evalCommand({ file, ...opts })
    })

  program
    .command('repl')
    .description('Start an interactive semantic search session (query loop with shared embedding provider)')
    .option('-k, --top <n>', 'number of results per query (default: 10)')
    .option('--level <level>', 'search level: file, chunk, symbol, module (default: file)')
    .option('--hybrid', 'enable hybrid (BM25+vector) search mode')
    .option('--model <model>', 'embedding model to use')
    .action(async (opts: { top?: string; level?: string; hybrid?: boolean; model?: string }) => {
      await replCommand(opts)
    })

  program
    .command('quickstart')
    .description('Guided onboarding wizard: detect provider, configure model, and index HEAD in one step')
    .action(async () => {
      await quickstartCommand()
    })

  program
    .command('regression-gate')
    .description('CI gate: fail if key concepts drift beyond threshold between two refs')
    .option('--base <ref>', 'base ref to compare from (default: main)')
    .option('--head <ref>', 'head ref to compare to (default: HEAD)')
    .option('--query <text>', 'single concept query to check')
    .option('--concepts <file>', 'JSON file with list of concept queries to check')
    .option('--threshold <n>', 'max allowed cosine drift (default: 0.15)')
    .option('--top <n>', 'top-k results to compare (default: 10)')
    .option('--format <fmt>', 'output format: text (default) or json')
    .action(async (opts: { base?: string; head?: string; query?: string; concepts?: string; threshold?: string; top?: string; format?: string }) => {
      await regressionGateCommand(opts)
    })

  program
    .command('cross-repo-similarity <query>')
    .description('Compare semantic similarity of a concept across two separately indexed repos')
    .option('--repo-a <db>', 'path to repo A .gitsema/index.db')
    .option('--repo-b <db>', 'path to repo B .gitsema/index.db')
    .option('--top <n>', 'top results per repo (default: 5)')
    .option('--threshold <n>', 'similarity threshold for shared-concept match (default: 0.7)')
    .option('--format <fmt>', 'output format: text (default) or json')
    .action(async (query: string, opts: { repoA?: string; repoB?: string; top?: string; threshold?: string; format?: string }) => {
      await crossRepoSimilarityCommand(query, opts)
    })

  program
    .command('code-review')
    .description('Semantic code review: find historical analogues for changed code and flag regressions')
    .option('--base <ref>', 'base git ref (e.g. main)')
    .option('--head <ref>', 'head git ref (e.g. HEAD)')
    .option('--diff-file <file>', 'read diff from a patch file instead of git')
    .option('--top <n>', 'top analogues per file (default: 5)')
    .option('--threshold <n>', 'minimum similarity score (default: 0.75)')
    .option('--format <fmt>', 'output format: text (default) or json')
    .action(async (opts: { base?: string; head?: string; diffFile?: string; top?: string; threshold?: string; format?: string }) => {
      await codeReviewCommand(opts)
    })
}

export default registerAll
