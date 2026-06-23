import { getRawDb } from '../../core/db/sqlite.js'
import { runDoctor } from '../../core/db/doctor.js'
import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { runStorageDoctor } from '../../core/storage/doctor.js'
import { verifyLspStartup } from '../../core/lsp/server.js'
import { execSync } from 'node:child_process'
import { backfillFts } from '../../core/indexing/backfillFts.js'
import { rebuildFts } from '../../core/db/rebuildFts.js'
import { runGarbageCollection } from '../../core/indexing/gc.js'

export async function doctorCommand(opts: { lsp?: boolean; extended?: boolean; fix?: boolean } = {}): Promise<void> {
  if (opts.lsp) {
    const result = verifyLspStartup()
    console.log(`LSP startup check: ${result.ok ? '✓' : '✗'}  ${result.message}`)
    if (!result.ok) process.exit(1)
    return
  }

  // Non-sqlite backends have no single database file to inspect — run the
  // cross-store checks available through the StorageProfile seam instead.
  const profile = getCachedStorageProfile(process.cwd())
  if (profile.backend !== 'sqlite') {
    const report = await runStorageDoctor(profile)

    console.log('=== gitsema doctor ===')
    console.log('')
    console.log(`Backend:           ${report.backend} (scope: ${report.scope})`)
    console.log(`Location:          ${report.location}`)
    console.log(`Blobs indexed:     ${report.blobCount}`)
    console.log(`File embeddings:   ${report.fileEmbeddingCount}`)
    console.log(`Path entries:      ${report.pathCount}`)
    console.log(`Commits mapped:    ${report.commitCount}`)
    console.log(`Commits indexed:   ${report.indexedCommitCount}`)
    console.log(`Branches tracked:  ${report.branchCount}`)
    console.log(`FTS/hybrid:        ${report.ftsEnabled ? 'enabled' : 'disabled'}`)
    if (report.lastIndexedCommit) console.log(`Last indexed:      ${report.lastIndexedCommit}`)

    if (report.warnings.length > 0) {
      console.log('')
      console.log('Warnings:')
      for (const w of report.warnings) console.log(`  ⚠  ${w}`)
    } else {
      console.log('')
      console.log('No issues detected. Index looks healthy.')
    }
    return
  }

  const rawDb = getRawDb()
  let report = runDoctor(rawDb)

  console.log('=== gitsema doctor ===')
  console.log('')
  console.log(`Schema version:    ${report.schemaVersion} (expected: ${report.expectedVersion}) ${report.schemaOk ? '✓' : '✗'}`)
  console.log(`Blobs indexed:     ${report.blobCount}`)
  console.log(`Embeddings stored: ${report.embeddingCount}`)
  console.log(`FTS rows:          ${report.ftsCount}`)
  if (report.ftsMissingCount > 0) {
    console.log(`FTS missing:       ${report.ftsMissingCount} (run: gitsema index rebuild-fts)`)
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

  // ── Auto-fix ─────────────────────────────────────────────────────────────
  if (opts.fix && (report.ftsMissingCount > 0 || report.orphanEmbeddings > 0)) {
    console.log('')
    console.log('=== Applying fixes ===')

    if (report.ftsMissingCount > 0) {
      console.log(`Backfilling FTS content for ${report.ftsMissingCount} blob(s)...`)
      const backfillStats = await backfillFts()
      console.log(`  Backfilled: ${backfillStats.backfilled}  Oversized: ${backfillStats.oversized}  Failed: ${backfillStats.failed}`)
      const rebuildResult = rebuildFts(rawDb)
      console.log(`  FTS5 rebuild complete. ${rebuildResult.rebuilt} rows indexed.`)
    }

    if (report.orphanEmbeddings > 0) {
      console.log(`Garbage-collecting unreachable blob records...`)
      const gcStats = await runGarbageCollection({ dryRun: false })
      console.log(`  Removed: ${gcStats.removed}/${gcStats.total}`)
    }

    report = runDoctor(rawDb)
    console.log('')
    console.log('=== Post-fix report ===')
    console.log(`FTS rows:          ${report.ftsCount}`)
    console.log(`FTS missing:       ${report.ftsMissingCount}`)
    console.log(`Orphan embeddings: ${report.orphanEmbeddings}`)
  }

  // Also run LSP check
  const lspResult = verifyLspStartup()
  console.log('')
  console.log(`LSP server check:  ${lspResult.ok ? '✓' : '✗'}  ${lspResult.message}`)

  // ── Extended pre-flight checks ──────────────────────────────────────────
  if (opts.extended) {
    console.log('')
    console.log('=== Extended checks ===')

    // 1. Model reachability — attempt a one-token embed call
    const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
    const modelName = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
    process.stdout.write(`Model reachability (${providerType}/${modelName}): `)
    try {
      const { buildProvider } = await import('../../core/embedding/providerFactory.js')
      const provider = buildProvider(providerType, modelName)
      await provider.embed('ping')
      console.log('✓ reachable')
    } catch (err) {
      console.log(`✗ unreachable — ${err instanceof Error ? err.message : String(err)}`)
    }

    // 2. Index freshness — compare last indexed commit ts to HEAD ts
    process.stdout.write('Index freshness:   ')
    try {
      const headTs = parseInt(
        execSync('git log -1 --format=%ct HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(),
        10,
      )
      const row = rawDb.prepare(
        'SELECT MAX(commit_ts) AS last_ts FROM indexed_commits ic JOIN commits c ON ic.commit_hash = c.commit_hash',
      ).get() as { last_ts: number | null } | undefined
      const lastTs = row?.last_ts ?? 0
      if (lastTs === 0) {
        console.log('⚠  No commits indexed yet')
      } else {
        const diffHrs = (headTs - lastTs) / 3600
        if (diffHrs < 0.1) {
          console.log('✓ up to date')
        } else if (diffHrs < 24) {
          console.log(`⚠  ${diffHrs.toFixed(1)} hours behind HEAD — consider: gitsema index start`)
        } else {
          const diffDays = diffHrs / 24
          console.log(`✗  ${diffDays.toFixed(1)} days behind HEAD — run: gitsema index start`)
        }
      }
    } catch {
      console.log('⚠  Could not determine (not a Git repo or no indexed commits)')
    }

    // 3. Search latency class
    const VSS_THRESHOLD = parseInt(process.env.GITSEMA_VSS_THRESHOLD ?? '50000', 10)
    const n = report.embeddingCount
    const { getVssIndexPaths } = await import('../../core/search/analysis/vectorSearch.js')
    const { existsSync } = await import('node:fs')
    const vssPaths = getVssIndexPaths(modelName)
    const vssReady = vssPaths !== null && existsSync(vssPaths.indexPath)
    let latencyClass: string
    if (n < 10000 || vssReady) {
      latencyClass = 'fast'
    } else if (n < VSS_THRESHOLD) {
      latencyClass = 'moderate'
    } else {
      latencyClass = 'slow'
    }
    const latencyIcon = latencyClass === 'fast' ? '✓' : latencyClass === 'moderate' ? 'ℹ' : '⚠'
    console.log(`Search latency:    ${latencyIcon}  ${latencyClass} (${n.toLocaleString()} embeddings, VSS: ${vssReady ? 'present' : 'absent'})`)
    if (latencyClass === 'slow') {
      console.log('   Recommendation: run `gitsema index build-vss` to create an HNSW approximate-nearest-neighbor index.')
    } else if (latencyClass === 'moderate') {
      console.log('   Tip: use --early-cut <n> to limit the candidate pool, or run `gitsema index build-vss`.')
    }
  }

  // Exit with non-zero if critical issues
  const critical = !report.integrityCheckPassed || !report.schemaOk
  if (critical) process.exit(1)
}
