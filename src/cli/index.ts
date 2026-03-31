import { Command } from 'commander'
import { statusCommand } from './commands/status.js'

const program = new Command()

program
  .name('gitsema')
  .description('A content-addressed semantic index synchronized with Git\'s object model.')
  .version('0.0.1')

program
  .command('status')
  .description('Show index status and database info')
  .action(statusCommand)

program.parse()
