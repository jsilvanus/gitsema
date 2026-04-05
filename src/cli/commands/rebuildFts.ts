import { createInterface } from 'node:readline'
import { getRawDb } from '../../core/db/sqlite.js'
import { rebuildFts } from '../../core/db/rebuildFts.js'

export async function rebuildFtsCliCommand(options: { yes?: boolean }): Promise<void> {
  if (!options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>((resolve) => {
      rl.question('Rebuild FTS index? This may take a moment on large databases. [y/N] ', resolve)
    })
    rl.close()
    if (!answer.match(/^y(es)?$/i)) {
      console.log('Aborted.')
      return
    }
  }

  const rawDb = getRawDb()
  const result = rebuildFts(rawDb)
  console.log(`FTS rebuild complete. ${result.rebuilt} rows indexed.`)
}
