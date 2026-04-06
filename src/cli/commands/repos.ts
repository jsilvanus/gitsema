import { Command } from 'commander'
import { getActiveSession } from '../../core/db/sqlite.js'
import { addRepo, listRepos, multiRepoSearch } from '../../core/indexing/repoRegistry.js'
import { buildProvider } from '../../core/embedding/providerFactory.js'
import { embedQuery } from '../../core/embedding/embedQuery.js'
import { parsePositiveInt } from '../../utils/parse.js'

export function reposCommand(): Command {
  const cmd = new Command('repos')
    .description('Manage tracked repositories for multi-repo indexing')

  cmd
    .command('add <id> <name> [url]')
    .description('Add a repository to the local registry')
    .option('--db-path <path>', 'path to the .gitsema/index.db of the remote repo')
    .action((id: string, name: string, url?: string, opts?: { dbPath?: string }) => {
      const session = getActiveSession()
      addRepo(session, id, name, url, opts?.dbPath)
      console.log(`Added repo ${id} (${name})${opts?.dbPath ? ` db: ${opts.dbPath}` : ''}`)
    })

  cmd
    .command('list')
    .description('List all tracked repositories')
    .option('--no-headings', "don't print column header row")
    .action((opts: { noHeadings?: boolean }) => {
      const session = getActiveSession()
      const repos = listRepos(session)
      if (repos.length === 0) {
        console.log('No repositories registered. Use: gitsema repos add <id> <name> [url]')
        return
      }
      if (!opts.noHeadings) {
        console.log(`${'ID'.padEnd(16)}\t${'Name'.padEnd(20)}\t${'URL'.padEnd(30)}\t${'DB_Path'.padEnd(20)}\tAdded`)
      }
      for (const r of repos) {
        const added = new Date(r.addedAt * 1000).toISOString().slice(0, 10)
        console.log(`${r.id}\t${r.name}\t${r.url ?? '(no url)'}\t${r.dbPath ?? '(no db-path)'}\t${added}`)
      }
    })

  cmd
    .command('search <query>')
    .description('Search across multiple registered repos (requires --db-path on each repo)')
    .option('--repos <ids>', 'comma-separated repo IDs to search (default: all)')
    .option('--top <n>', 'number of results (default 10)', '10')
    .option('--model <model>', 'embedding model override')
    .option('--no-headings', "don't print column header row")
    .action(async (query: string, opts: { repos?: string; top?: string; model?: string; noHeadings?: boolean }) => {
      let topK: number
      try {
        topK = parsePositiveInt(opts.top ?? '10', '--top')
      } catch (e) {
        console.error(String(e))
        process.exit(1)
      }
      const session = getActiveSession()
      const repoIds = opts.repos ? opts.repos.split(',').map((s) => s.trim()) : undefined
      const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
      const model = opts.model ?? process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
      const provider = buildProvider(providerType, model)
      let embedding: number[]
      try {
        embedding = await embedQuery(provider, query) as number[]
      } catch (e) {
        console.error(`Error embedding query: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
        throw e
      }
      const results = await multiRepoSearch(session, embedding, { repoIds, topK, model })
      if (results.length === 0) {
        console.log('No results. Ensure repos have --db-path set and are indexed.')
        return
      }
      if (!opts.noHeadings) {
        console.log(`${'Repo'.padEnd(16)}  ${'Score'.padEnd(6)}  Path`)
      }
      for (const r of results) {
        const path = r.paths?.[0] ?? r.blobHash.slice(0, 8)
        console.log(`[${r.repoId}] ${r.score.toFixed(3)}  ${path}`)
      }
    })

  return cmd
}
