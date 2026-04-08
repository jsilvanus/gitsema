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
import { collectOut } from '../../utils/outputSink.js'

export function registerAnalysis(program: Command) {
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
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|html[:file]|markdown[:file] (overrides --dump/--html)', collectOut, [] as string[])       
    .action(async (options) => {
      await prReportCommand(options)
    })

  program
    .command('triage <query>')
    .description('Incident triage: composite workflow (first-seen, change-points, file-evolution, bisect, experts)')
    .option('--ref1 <ref>', 'bisect left ref')
    .option('--ref2 <ref>', 'bisect right ref')
    .option('--file <path>', 'focus on a specific file')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given (legacy: prefer --out json)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file]|markdown[:file] (overrides --dump)', collectOut, [] as string[])
    .option('-k, --top <n>', 'number of top results per section', '5')
    .action(async (query: string, opts: any) => { await triageCommand(query, { ref1: opts.ref1, ref2: opts.ref2, file: opts.file, dump: opts.dump, out: opts.out, top: opts.top }) })

  program
    .command('policy check')
    .description('Run policy gates for drift, debt, and security scores (CI-friendly exit codes)')
    .option('--max-drift <n>', 'fail if any concept change-point distance exceeds n')
    .option('--max-debt-score <n>', 'fail if aggregate debt score exceeds n')     
    .option('--min-security-score <n>', 'fail if any security similarity score is below this threshold')
    .option('--query <text>', 'concept query (required for drift gate)')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given (legacy: prefer --out json)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file] (overrides --dump)', collectOut, [] as string[])
    .action(async (opts: any) => { await policyCheckCommand({ maxDrift: opts.maxDrift, maxDebtScore: opts.maxDebtScore, minSecurityScore: opts.minSecurityScore, query: opts.query, dump: opts.dump, out: opts.out }) })

  program
    .command('ownership <query>')
    .description('Show ownership heatmap for a concept (ownership confidence and trends)')
    .option('-k, --top <n>', 'number of owners to show', '5')
    .option('--window <days>', 'compare ownership in last N days vs before (default 90)', '90')
    .option('--dump [file]', 'output structured JSON; writes to <file> if given (legacy: prefer --out json)')
    .option('--out <spec>', 'output spec (repeatable): text|json[:file] (overrides --dump)', collectOut, [] as string[])
    .action(async (query: string, opts: any) => { await ownershipCommand(query, { top: opts.top, window: opts.window, dump: opts.dump, out: opts.out }) })        

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
