import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { startLspServer } from '../../core/lsp/server.js'

export function lspCommand(): Command {
  return new Command('lsp')
    .description('Start the LSP-compatible semantic hover server (JSON-RPC over stdio) [deprecated: use `gitsema tools lsp`]')
    .action(() => {
      console.warn('Deprecation notice: `gitsema lsp` is deprecated — use `gitsema tools lsp` instead.')
      const session = getActiveSession()
      startLspServer(session)
    })
}
