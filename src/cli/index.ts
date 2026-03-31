import { Command } from 'commander'
import { statusCommand } from './commands/status.js'
import { indexCommand } from './commands/index.js'
import { searchCommand } from './commands/search.js'
import { firstSeenCommand } from './commands/firstSeen.js'

const program = new Command()

program
  .name('gitsema')
  .description('A content-addressed semantic index synchronized with Git\'s object model.')
  .version('0.0.1')

program
  .command('status')
  .description('Show index status and database info')
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
  .action(indexCommand)

program
  .command('search <query>')
  .description('Semantically search the index for blobs matching the query')
  .option('-k, --top <n>', 'number of results to return', '10')
  .option('--recent', 'blend cosine similarity with a recency score')
  .option('--alpha <n>', 'weight for cosine similarity in blended score (0–1, default 0.8)')
  .option('--before <date>', 'only include blobs first seen before this date (YYYY-MM-DD)')
  .option('--after <date>', 'only include blobs first seen after this date (YYYY-MM-DD)')
  .action(searchCommand)

program
  .command('first-seen <query>')
  .description('Find when a concept first appeared in the codebase, sorted by date')
  .option('-k, --top <n>', 'number of results to return', '10')
  .action(firstSeenCommand)

program.parse()

