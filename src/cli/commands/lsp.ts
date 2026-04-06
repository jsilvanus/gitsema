import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { startLspServer } from '../../core/lsp/server.js'

export function lspCommand(): Command {
  return new Command('lsp')
    .description('Start the LSP-compatible semantic hover server (JSON-RPC over stdio)')
    .action(() => {
      const session = getActiveSession()
      startLspServer(session)
    })
}
