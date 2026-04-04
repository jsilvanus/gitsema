import { getRawDb } from '../../core/db/sqlite.js'

export async function branchesCommand(): Promise<void> {
  const raw = getRawDb()
  const rows = raw.prepare('SELECT branch_name, COUNT(DISTINCT blob_hash) AS blob_count FROM blob_branches GROUP BY branch_name ORDER BY blob_count DESC').all() as Array<{ branch_name: string; blob_count: number }>

  console.log('Branches in index:\n')
  for (const r of rows) {
    const name = r.branch_name.padEnd(15)
    console.log(`  ${name} ${r.blob_count} blobs`)
  }
  console.log(`\nTotal: ${rows.length} branches`)
}
