import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { filterByTimeRangeLastSeen } from '../src/core/search/temporal/timeSearch.js'
import { execSync } from 'node:child_process'

const repo = 'C:/Users/jsilv/AppData/Local/Temp/gitsema-time-VNveX3'
const dbPath = `${repo}/test.db`
const session = openDatabaseAt(dbPath)

await withDbSession(session, async () => {
  const commits = session.rawDb.prepare('SELECT commit_hash, timestamp FROM commits ORDER BY timestamp ASC').all()
  console.log('commits', commits)
  const tMidRow = session.rawDb.prepare('SELECT timestamp FROM commits ORDER BY timestamp ASC LIMIT 1 OFFSET 1').get()
  const tMid = tMidRow ? tMidRow.timestamp : null
  console.log('tMid', tMid)
  const rows = session.rawDb.prepare('SELECT DISTINCT blob_hash FROM embeddings').all()
  const allHashes = rows.map(r => r.blob_hash)
  console.log('allHashes', allHashes)
  const filtered = filterByTimeRangeLastSeen(allHashes, undefined, tMid)
  console.log('filtered', filtered)
})

process.exit(0)
