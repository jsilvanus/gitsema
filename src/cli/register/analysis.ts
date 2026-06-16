import { Command } from 'commander'
import { prReportCommand } from '../commands/prReport.js'
import { triageCommand } from '../commands/triage.js'
import { policyCheckCommand } from '../commands/policyCheck.js'
import { ownershipCommand } from '../commands/ownership.js'
import { evalCommand } from '../commands/eval.js'
import { replCommand } from '../commands/repl.js'
import { quickstartCommand } from '../commands/quickstart.js'
import { regressionGateCommand } from '../commands/regressionGate.js'
import { crossRepoSimilarityCommand } from '../commands/crossRepoSimilarity.js'
import { codeReviewCommand } from '../commands/codeReview.js'
import { registerNarratorCommands } from '../commands/narrate.js'
import { registerGuideCommand } from '../commands/guide.js'
import { collectOut } from '../../utils/outputSink.js'
import { addLensOption } from '../lib/lens.js'

export function registerAnalysis(program: Command) {
  program
    .command('pr-report')
    .description('Compose a semantic PR report: diff, impacted modules, change-points, reviewer suggestions')
    .option('--ref1 <ref>', 'Base ref (default: HEAD~1)', 'HEAD~1')
    .option('--ref2 <ref>', 'Head ref (default: HEAD)', 'HEAD')
    .option('--file <path>', 'File path to analyze for semantic diff and impact') 
    .option('--query <text>', 'Concept query for change-point highlights')        
    .option('-k, --top <n>', 'Result limit', '10')
    .option('--since <date>', 'Filter reviewer activity since date (YYYY-MM-DD or ISO 8601)')
    .option('--until <date>', 'Filter reviewer activity until date (YYYY-MM-DD or ISO 8601)')
    .option('--dump [file]', 'Output JSON report; writes to file or stdout if no path given')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])       
    .action(async (options) => {
      await prReportCommand(options)
    })

  addLensOption(
    program
      .command('triage <query>')
      .description('Incident triage: composite workflow (first-seen, change-points, file-evolution, bisect, experts)')
      .option('--ref1 <ref>', 'bisect left ref')
      .option('--ref2 <ref>', 'bisect right ref')
      .option('--file <path>', 'focus on a specific file')
      .option('--dump [file]', 'output structured JSON; writes to <file> if given (legacy: prefer --out json)')
      .option('--out <spec>', 'output spec (repeatable): text|json[:file]|markdown[:file] (overrides --dump)', collectOut, [] as string[])
      .option('-k, --top <n>', 'number of top results per section', '5')
      .option('--narrate', 'generate an LLM narrative of the triage bundle (requires GITSEMA_LLM_URL)'),
    'semantic',
  ).action(async (query: string, opts: any) => { await triageCommand(query, { ref1: opts.ref1, ref2: opts.ref2, file: opts.file, dump: opts.dump, out: opts.out, top: opts.top, narrate: opts.narrate, lens: opts.lens }) })

  const policyCheckAction = async (opts: any) => {
    await policyCheckCommand({ maxDrift: opts.maxDrift, maxDebtScore: opts.maxDebtScore, minSecurityScore: opts.minSecurityScore, query: opts.query, dump: opts.dump, out: opts.out })
  }

  program
    .command('policy-check')
    .description('Run policy gates for drift, debt, and security scores (CI-friendly exit codes). Exit codes: 0 = ok, 1 = runtime error, 2 = usage error, 3 = gate failed.')
    .option('--max-drift <n>', 'fail if any concept change-point distance exceeds n (cosine distance, 0–2)')
    .option('--max-debt-score <n>', 'fail if aggregate debt score exceeds n')
    .option('--min-security-score <n>', 'fail if any security finding similarity exceeds this threshold (cosine similarity, 0–1)')
    .option('--query <text>', 'concept query (required for drift gate)')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given (legacy: prefer --out json)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file] (overrides --dump)', collectOut, [] as string[])
    .action(policyCheckAction)

  // Deprecated alias for the old two-word `policy check` form.
  const policy = program.command('policy', { hidden: true })
  policy
    .command('check')
    .description('Alias for `policy-check` [deprecated: use `gitsema policy-check`]')
    .option('--max-drift <n>', 'fail if any concept change-point distance exceeds n (cosine distance, 0–2)')
    .option('--max-debt-score <n>', 'fail if aggregate debt score exceeds n')
    .option('--min-security-score <n>', 'fail if any security finding similarity exceeds this threshold (cosine similarity, 0–1)')
    .option('--query <text>', 'concept query (required for drift gate)')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given (legacy: prefer --out json)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file] (overrides --dump)', collectOut, [] as string[])
    .action(async (opts: any) => {
      console.warn('Deprecation notice: `gitsema policy check` is deprecated — use `gitsema policy-check` instead.')
      await policyCheckAction(opts)
    })

  program
    .command('ownership <query>')
    .description('Show ownership heatmap for a concept (ownership confidence and trends)')
    .option('-k, --top <n>', 'number of owners to show', '5')
    .option('--window <days>', 'compare ownership in last N days vs before (default 90)', '90')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given (legacy: prefer --out json)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file] (overrides --dump)', collectOut, [] as string[])
    .option('--narrate', 'generate an LLM narrative of the ownership heatmap (requires GITSEMA_LLM_URL)')
    .action(async (query: string, opts: any) => { await ownershipCommand(query, { top: opts.top, window: opts.window, dump: opts.dump, out: opts.out, narrate: opts.narrate }) })

  program
    .command('eval <file>')
    .description('Evaluate retrieval quality against a JSONL file of (query, expectedPaths) pairs.')
    .option('-k, --top <n>', 'retrieve top-k results per query (default: 10)')
    .option('--dump [file]', 'write full JSON results to <file> (or stdout if no file given) (legacy: prefer --out json)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])
    .action(async (file: string, opts: { top?: string; dump?: string | boolean; out?: string[] }) => {
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
    .description('Guided onboarding wizard: detect provider, configure model, select storage backend, and index HEAD in one step (alias: `gitsema setup`)')
    .action(async () => {
      await quickstartCommand()
    })

  program
    .command('setup')
    .description('Guided onboarding wizard: detect provider, configure model, select storage backend, and index HEAD in one step (alias of `gitsema quickstart`)')
    .action(async () => {
      await quickstartCommand()
    })

  program
    .command('regression-gate')
    .description('CI gate: fail if key concepts drift beyond threshold between two refs. Exit codes: 0 = ok, 1 = runtime error, 2 = usage error, 3 = gate failed.')
    .option('--base <ref>', 'base ref to compare from (default: main)')
    .option('--head <ref>', 'head ref to compare to (default: HEAD)')
    .option('--query <text>', 'single concept query to check')
    .option('--concepts <file>', 'JSON file with list of concept queries to check')
    .option('--threshold <n>', 'max allowed cosine drift (cosine distance, 0–2, default: 0.15)')
    .option('-k, --top <n>', 'top-k results to compare (default: 10)')
    .option('--format <fmt>', 'output format: text (default) or json (legacy: prefer --out <fmt>)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file] (overrides --format)', collectOut, [] as string[])
    .action(async (opts: { base?: string; head?: string; query?: string; concepts?: string; threshold?: string; top?: string; format?: string; out?: string[] }) => {
      await regressionGateCommand(opts)
    })

  program
    .command('cross-repo-similarity <query>')
    .description('Compare semantic similarity of a concept across two separately indexed repos')
    .option('--repo-a <db>', 'path to repo A .gitsema/index.db')
    .option('--repo-b <db>', 'path to repo B .gitsema/index.db')
    .option('-k, --top <n>', 'top results per repo (default: 5)')
    .option('--threshold <n>', 'similarity threshold for shared-concept match (cosine similarity, 0–1, default: 0.7)')
    .option('--format <fmt>', 'output format: text (default) or json (legacy: prefer --out <fmt>)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file] (overrides --format)', collectOut, [] as string[])
    .action(async (query: string, opts: { repoA?: string; repoB?: string; top?: string; threshold?: string; format?: string; out?: string[] }) => {
      await crossRepoSimilarityCommand(query, opts)
    })

  addLensOption(
    program
      .command('code-review')
      .description('Semantic code review: find historical analogues for changed code and flag regressions. Exit codes: 0 = ok, 1 = runtime error, 2 = usage error, 3 = gate failed.')
      .option('--base <ref>', 'base git ref (e.g. main)')
      .option('--head <ref>', 'head git ref (e.g. HEAD)')
      .option('--diff-file <file>', 'read diff from a patch file instead of git')
      .option('-k, --top <n>', 'top analogues per file (default: 5)')
      .option('--threshold <n>', 'minimum similarity score (cosine similarity, 0–1, default: 0.75)')
      .option('--format <fmt>', 'output format: text (default) or json (legacy: prefer --out <fmt>)')
      .option('--out <spec>', 'output spec (repeatable): text|json[:file] (overrides --format)', collectOut, [] as string[]),
    'semantic',
  ).action(async (opts: { base?: string; head?: string; diffFile?: string; top?: string; threshold?: string; format?: string; out?: string[]; lens?: string }) => {
      await codeReviewCommand(opts)
    })

  registerNarratorCommands(program)
  registerGuideCommand(program)
}
