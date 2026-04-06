import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { addRepo, listRepos } from '../../core/indexing/repoRegistry.js'

export function reposCommand(): Command {
  const cmd = new Command('repos')
    .description('Manage tracked repositories for multi-repo indexing')

  cmd
    .command('add <id> <name> [url]')
    .description('Add a repository to the local registry')
    .action((id: string, name: string, url?: string) => {
      const session = getActiveSession()
      addRepo(session, id, name, url)
      console.log(`Added repo ${id} (${name})`)
    })

  cmd
    .command('list')
    .description('List all tracked repositories')
    .action(() => {
      const session = getActiveSession()
      const repos = listRepos(session)
      if (repos.length === 0) {
        console.log('No repositories registered. Use: gitsema repos add <id> <name> [url]')
        return
      }
      for (const r of repos) {
        const added = new Date(r.addedAt * 1000).toISOString().slice(0, 10)
        console.log(`${r.id}\t${r.name}\t${r.url ?? '(no url)'}\t${added}`)
      }
    })

  return cmd
}
