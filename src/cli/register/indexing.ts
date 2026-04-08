import { Command } from 'commander'
import { indexCommand, indexStartCommand } from '../commands/index.js'
import { doctorCommand } from '../commands/doctor.js'
import { exportIndex, importIndex } from '../commands/bundleIndex.js'
import { backfillFtsCommand } from '../commands/backfillFts.js'
import { updateModulesCommand } from '../commands/updateModules.js'
import { runGarbageCollection } from '../../core/indexing/gc.js'
import { vacuumCommand } from '../commands/vacuum.js'
import { rebuildFtsCliCommand } from '../commands/rebuildFts.js'
import { clearModelCommand } from '../commands/clearModel.js'
import { buildVssCommand } from '../commands/buildVss.js'

export function registerIndexing(program: Command) {
  program
    .command('index')
    .description('Show index coverage (blob counts per model). Run `gitsema index start` to perform indexing.')
    .addHelpText(
      'after',
      '\nShows how many Git-reachable blobs have been embedded, broken down by embedding\n' +
      'model/config.  This command is read-only and never modifies the database.\n\n' +
      'To start indexing, run:\n' +
      '  gitsema index start\n\n' +
      'To force a full re-index from scratch:\n' +
      '  gitsema index start --since all\n\n' +
      'For a quick file status, use: gitsema status',
    )
    .action(indexCommand)

  // index export / index import — Phase 54 subcommands
  // (export-index and import-index top-level aliases kept for backward compatibility)

  const indexSub = program.commands.find((c) => c.name() === 'index')!

  // ── `gitsema index start` — performs actual indexing ─────────────────────
  indexSub
    .command('start')
    .description('Walk Git history and embed all blobs into the semantic index (starts from HEAD first)')
    .addHelpText(
      'after',
      '\nDefault mode is INCREMENTAL: automatically resumes from the last indexed commit.\n' +
      'Indexing starts from HEAD first (fastest time-to-first-results), then walks history.\n' +
      'Use --since all to force a full re-index from scratch.\n\n' +
      'Progress output shows: stage (collecting/embedding/commit-mapping), % complete,\n' +
      'throughput (blobs/s), embedding latency (avg + p95), and ETA.\n' +
      'A final summary prints per-stage timings and totals.\n\n' +
      'Performance tuning tips:\n' +
      '  - Increase --concurrency if your embedding server supports parallel requests\n' +
      '  - Use --chunker fixed with a smaller --window-size if you hit context-length errors\n' +
      '  - Use --ext to limit indexed file types (e.g. ".ts,.py") and reduce noise\n' +
      '  - Use --exclude node_modules,dist to skip irrelevant paths\n' +
      '  - Run `gitsema doctor` after indexing to verify index health',
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
    .option('--model <model>', 'override embedding model')
    .option('--text-model <model>', 'override text/prose embedding model')
    .option('--code-model <model>', 'override source-code embedding model (defaults to text model)')
    .option('--quantize', 'store embeddings as int8-quantized vectors (4× smaller, ~1% recall loss)')
    .option('--build-vss', 'build a usearch HNSW ANN index after indexing completes (requires usearch package)')
    .option('--auto-build-vss [threshold]', 'automatically build VSS index after indexing when blob count exceeds threshold (default: 10000)')
    .option('--allow-mixed', 'allow indexing with a different embed config than previously used (skip compatibility check)')
    .option('--profile <name>', 'apply a preset profile: speed (high concurrency, large batches), balanced (default), quality (deep chunking)')
    .option(
      '--level <level>',
      'indexing granularity: blob (one embedding per file, same as --chunker file), function (function/class boundaries, same as --chunker function), fixed (fixed-size windows). Alias for --chunker.',
    )
    .action(indexStartCommand)

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

  // ── `gitsema index doctor` ────────────────────────────────────────────────
  indexSub
    .command('doctor')
    .description('Run integrity checks, schema version/provenance checks, and report index health')
    .option('--lsp', 'only run the LSP startup check')
    .option('--extended', 'run extended pre-flight checks (model reachability, index freshness, latency class)')
    .action(async (opts: { lsp?: boolean; extended?: boolean }) => {
      await doctorCommand(opts)
    })

  // ── `gitsema index vacuum` ────────────────────────────────────────────────
  indexSub
    .command('vacuum')
    .description('VACUUM and ANALYZE the SQLite index database to reduce size and improve performance')
    .action(async () => {
      await vacuumCommand()
    })

  // ── `gitsema index rebuild-fts` ───────────────────────────────────────────
  indexSub
    .command('rebuild-fts')
    .description('Rebuild the FTS5 full-text search index from stored data')
    .option('-y, --yes', 'skip confirmation prompt')
    .action(async (opts: { yes?: boolean }) => {
      await rebuildFtsCliCommand({ yes: opts.yes })
    })

  // ── `gitsema index backfill-fts` ──────────────────────────────────────────
  indexSub
    .command('backfill-fts')
    .description('Populate FTS5 content for blobs indexed before Phase 11 (enables hybrid search)')
    .action(async () => {
      await backfillFtsCommand()
    })

  // ── `gitsema index update-modules` ────────────────────────────────────────
  indexSub
    .command('update-modules')
    .description('Recalculate module (directory) centroid embeddings from stored whole-file embeddings')
    .option('--verbose', 'enable verbose output')
    .action(async (opts: { verbose?: boolean }) => {
      await updateModulesCommand({ verbose: opts.verbose })
    })

  // ── `gitsema index gc` ────────────────────────────────────────────────────
  indexSub
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

  // ── `gitsema index clear-model <model>` ───────────────────────────────────
  indexSub
    .command('clear-model <model>')
    .description('Delete all stored embeddings and cache entries for a specific model')
    .option('-y, --yes', 'skip confirmation prompt')
    .action(async (model: string, opts: { yes?: boolean }) => {
      await clearModelCommand(model, { yes: opts.yes })
    })

  // ── `gitsema index build-vss` ─────────────────────────────────────────────
  indexSub
    .command('build-vss')
    .description('Build a usearch HNSW ANN index from stored embeddings for fast approximate search (requires usearch package)')
    .option('--model <model>', 'build index for this model (default: configured text model)')
    .option('--ef-construction <n>', 'HNSW ef_construction parameter — higher = better recall, slower build (default 200)')
    .option('--M <n>', 'HNSW M parameter — number of connections per layer (default 16)')
    .action(async (opts: { model?: string; efConstruction?: string; M?: string }) => {
      await buildVssCommand({
        model: opts.model,
        efConstruction: opts.efConstruction,
        M: opts.M,
      })
    })

  // ── Top-level deprecated aliases (hidden; kept for backward compat) ────────
  program
    .command('doctor', { hidden: true })
    .description('[deprecated] use `gitsema index doctor`')
    .option('--lsp', 'only run the LSP startup check (gitsema index doctor --lsp)')
    .option('--extended', 'run extended pre-flight checks')
    .action(async (opts: { lsp?: boolean; extended?: boolean }) => {
      console.warn('Deprecation notice: `gitsema doctor` is deprecated — use `gitsema index doctor` instead.')
      await doctorCommand(opts)
    })

  program
    .command('vacuum', { hidden: true })
    .description('[deprecated] use `gitsema index vacuum`')
    .action(async () => {
      console.warn('Deprecation notice: `gitsema vacuum` is deprecated — use `gitsema index vacuum` instead.')
      await vacuumCommand()
    })

  program
    .command('rebuild-fts', { hidden: true })
    .description('[deprecated] use `gitsema index rebuild-fts`')
    .option('-y, --yes', 'skip confirmation prompt')
    .action(async (opts: { yes?: boolean }) => {
      console.warn('Deprecation notice: `gitsema rebuild-fts` is deprecated — use `gitsema index rebuild-fts` instead.')
      await rebuildFtsCliCommand({ yes: opts.yes })
    })

  program
    .command('backfill-fts', { hidden: true })
    .description('[deprecated] use `gitsema index backfill-fts`')
    .action(async () => {
      console.warn('Deprecation notice: `gitsema backfill-fts` is deprecated — use `gitsema index backfill-fts` instead.')
      await backfillFtsCommand()
    })

  program
    .command('update-modules', { hidden: true })
    .description('[deprecated] use `gitsema index update-modules`')
    .option('--verbose', 'enable verbose output')
    .action(async (opts: { verbose?: boolean }) => {
      console.warn('Deprecation notice: `gitsema update-modules` is deprecated — use `gitsema index update-modules` instead.')
      await updateModulesCommand({ verbose: opts.verbose })
    })

  program
    .command('gc', { hidden: true })
    .description('[deprecated] use `gitsema index gc`')
    .option('--dry-run', 'only report what would be removed')
    .option('--verbose', 'print verbose output')
    .action(async (opts: { dryRun?: boolean; verbose?: boolean }) => {
      console.warn('Deprecation notice: `gitsema gc` is deprecated — use `gitsema index gc` instead.')
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
    .command('clear-model <model>', { hidden: true })
    .description('[deprecated] use `gitsema index clear-model`')
    .option('-y, --yes', 'skip confirmation prompt')
    .action(async (model: string, opts: { yes?: boolean }) => {
      console.warn('Deprecation notice: `gitsema clear-model` is deprecated — use `gitsema index clear-model` instead.')
      await clearModelCommand(model, { yes: opts.yes })
    })

  program
    .command('build-vss', { hidden: true })
    .description('[deprecated] use `gitsema index build-vss`')
    .option('--model <model>', 'build index for this model (default: configured text model)')
    .option('--ef-construction <n>', 'HNSW ef_construction parameter (default 200)')
    .option('--M <n>', 'HNSW M parameter (default 16)')
    .action(async (opts: { model?: string; efConstruction?: string; M?: string }) => {
      console.warn('Deprecation notice: `gitsema build-vss` is deprecated — use `gitsema index build-vss` instead.')
      await buildVssCommand({
        model: opts.model,
        efConstruction: opts.efConstruction,
        M: opts.M,
      })
    })
}
