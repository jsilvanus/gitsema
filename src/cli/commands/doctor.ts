import { getRawDb } from '../../core/db/sqlite.js'
import { runDoctor } from '../../core/db/doctor.js'
import { verifyLspStartup } from '../../core/lsp/server.js'

export async function doctorCommand(opts: { lsp?: boolean } = {}): Promise<void> {
  if (opts.lsp) {
    const result = verifyLspStartup()
    console.log(`LSP startup check: ${result.ok ? '✓' : '✗'}  ${result.message}`)
    if (!result.ok) process.exit(1)
    return
  }

  const rawDb = getRawDb()
  const report = runDoctor(rawDb)

  console.log('=== gitsema doctor ===')
  console.log('')
  console.log(`Schema version:    ${report.schemaVersion} (expected: ${report.expectedVersion}) ${report.schemaOk ? '✓' : '✗'}`)
  console.log(`Blobs indexed:     ${report.blobCount}`)
  console.log(`Embeddings stored: ${report.embeddingCount}`)
  console.log(`FTS rows:          ${report.ftsCount}`)
  if (report.ftsMissingCount > 0) {
    console.log(`FTS missing:       ${report.ftsMissingCount} (run: gitsema index backfill-fts)`)
  }
  if (report.orphanEmbeddings > 0) {
    console.log(`Orphan embeddings: ${report.orphanEmbeddings} (run: gitsema index gc)`)
  }
  console.log(`Integrity check:   ${report.integrityCheckPassed ? 'passed ✓' : 'FAILED ✗'}`)
  if (report.integrityErrors.length > 0) {
    for (const err of report.integrityErrors) {
      console.log(`  - ${err}`)
    }
  }

  if (report.embedConfigs.length > 0) {
    console.log('')
    console.log(`Embed configs (${report.embedConfigs.length}):`)
    for (const c of report.embedConfigs) {
      const hash = c.configHash.slice(0, 8)
      const date = new Date(c.createdAt * 1000).toISOString().slice(0, 10)
      console.log(`  [${hash}] ${c.provider} / ${c.model} / ${c.dimensions} dims / ${c.chunker} chunker  (${date})`)
    }
  } else {
    console.log('')
    console.log('No embed configs stored (provenance not yet tracked).')
  }

  if (report.warnings.length > 0) {
    console.log('')
    console.log('Warnings:')
    for (const w of report.warnings) {
      console.log(`  ⚠  ${w}`)
    }
  } else {
    console.log('')
    console.log('No issues detected. Index looks healthy.')
  }

  // Also run LSP check
  const lspResult = verifyLspStartup()
  console.log('')
  console.log(`LSP server check:  ${lspResult.ok ? '✓' : '✗'}  ${lspResult.message}`)

  // Exit with non-zero if critical issues
  const critical = !report.integrityCheckPassed || !report.schemaOk
  if (critical) process.exit(1)
}
