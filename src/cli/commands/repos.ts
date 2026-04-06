import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { addRepo, listRepos } from '../../core/indexing/repoRegistry.js'

export function reposCommand(): Command {
  return new Command('repos')
    .description('Manage tracked repositories for multi-repo indexing')
    .command('add <id> <name> [url]')
    .description('Add a repository to the local registry')
    .action((id: string, name: string, url?: string) => {
      const session = getActiveSession()
      addRepo(session, id, name, url)
      console.log(`Added repo ${id} (${name})`)
    })
}

export function reposListCommand(): Command {
  return new Command('repos:list')
    .description('List tracked repositories')
    .action(() => {
      const session = getActiveSession()
      const repos = listRepos(session)
      for (const r of repos) console.log(`${r.id}\t${r.name}\t${r.url ?? ''}\t${r.addedAt}`)
    })
}
