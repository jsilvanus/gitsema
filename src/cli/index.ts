import { Command } from 'commander'
import { statusCommand } from './commands/status.js'
import { indexCommand } from './commands/index.js'
import { searchCommand } from './commands/search.js'

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
  .action(indexCommand)

program
  .command('search <query>')
  .description('Semantically search the index for blobs matching the query')
  .option('-k, --top <n>', 'number of results to return', '10')
  .action(searchCommand)

program.parse()
