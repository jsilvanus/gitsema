import { Command } from 'commander'
import { statusCommand } from './commands/status.js'
import { indexCommand } from './commands/index.js'

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

program.parse()
