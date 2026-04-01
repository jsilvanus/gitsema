import { backfillFts } from '../../core/indexing/backfillFts.js'

export async function backfillFtsCommand(): Promise<void> {
  console.log('Scanning for blobs missing FTS content...')

  let lastPct = -1
  const stats = await backfillFts({
    onProgress(done, total) {
      if (total === 0) return
      const pct = Math.floor((done / total) * 100)
      if (pct !== lastPct && pct % 10 === 0) {
        process.stdout.write(`\r  ${done}/${total} (${pct}%)`)
        lastPct = pct
      }
    },
  })

  if (stats.total === 0) {
    console.log('All blobs already have FTS content — nothing to backfill.')
    return
  }

  // Ensure the progress line is cleared
  process.stdout.write('\r')

  console.log(`Backfill complete in ${(stats.elapsed / 1000).toFixed(1)}s`)
  console.log(`  Blobs missing FTS: ${stats.total}`)
  console.log(`  Backfilled:        ${stats.backfilled}`)
  console.log(`  Oversized (skipped): ${stats.oversized}`)
  console.log(`  Failed:            ${stats.failed}`)
}
