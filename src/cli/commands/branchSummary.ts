import { writeFileSync } from 'node:fs'
import {
  computeBranchSummary,
  type BranchSummaryResult,
  type DriftedPath,
} from '../../core/search/branchSummary.js'
import { renderBranchSummaryHtml } from '../../core/viz/htmlRenderer.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface BranchSummaryCommandOptions {
  base?: string
  top?: string
  dump?: string | boolean
  html?: string | boolean
  enhancedLabels?: boolean
  enhancedKeywordsN?: string
  out?: string[]
}

/**
 * `gitsema branch-summary <branch>`
 *
 * Generates a high-level semantic description of what a branch "is about"
 * compared to its base branch, using cluster proximity and semantic drift.
 */
export async function branchSummaryCommand(
  branch: string,
  options: BranchSummaryCommandOptions,
): Promise<void> {
  const baseBranch = options.base ?? 'main'
  const topConcepts = options.top !== undefined ? parseInt(options.top, 10) : 5
  const enhancedKeywordsN = options.enhancedKeywordsN !== undefined ? parseInt(options.enhancedKeywordsN, 10) : 8

  if (isNaN(topConcepts) || topConcepts < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  try {
    const result = await computeBranchSummary(branch, baseBranch, { topConcepts })

    const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: options.html })
    const jsonSink = getSink(sinks, 'json')
    const htmlSink = getSink(sinks, 'html')

    // Strip the heavy centroid array from JSON output unless explicitly needed
    const json = JSON.stringify(
      { ...result, branchCentroid: `[${result.branchCentroid.length} dimensions]` },
      null,
      2,
    )

    if (jsonSink) {
      if (jsonSink.file) {
        writeFileSync(jsonSink.file, json, 'utf8')
        console.log(`Wrote branch-summary JSON to ${jsonSink.file}`)
      } else {
        process.stdout.write(json + '\n')
        return
      }
      if (!hasSinkFormat(sinks, 'text') && !hasSinkFormat(sinks, 'html')) return
    }

    if (htmlSink) {
      const html = renderBranchSummaryHtml(result)
      if (htmlSink.file) {
        writeFileSync(htmlSink.file, html, 'utf8')
        console.log(`Branch summary HTML written to: ${htmlSink.file}`)
      } else {
        process.stdout.write(html + '\n')
      }
      if (!hasSinkFormat(sinks, 'text')) return
    }

    printResult(result, baseBranch, options.enhancedLabels ? enhancedKeywordsN : 5)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function driftLabel(drift: number): string {
  if (drift < 0.05) return 'stable'
  if (drift < 0.15) return 'minor shift'
  if (drift < 0.3) return 'moderate shift'
  return 'large shift'
}

function printResult(result: BranchSummaryResult, baseBranch: string, keywordsN = 5): void {
  console.log(
    `Branch summary: ${result.branch} vs ${baseBranch} (merge base: ${result.mergeBase.slice(0, 8)})`,
  )
  console.log(`Exclusive blobs: ${result.exclusiveBlobCount}`)
  console.log('')

  if (result.exclusiveBlobCount === 0) {
    console.log('No exclusive blobs found — this branch has no commits beyond the merge base.')
    console.log('Ensure the branch is indexed with `gitsema index`.')
    return
  }

  if (result.nearestConcepts.length === 0) {
    console.log(
      'No concept clusters available. Run `gitsema clusters` first to enable concept matching.',
    )
  } else {
    console.log('This branch is semantically about:')
    result.nearestConcepts.forEach((c, i) => {
      console.log(
        `  ${i + 1}. "${c.clusterLabel}"  — similarity ${c.similarity.toFixed(3)}`,
      )
      if (c.topKeywords.length > 0) {
        console.log(`     Keywords: ${c.topKeywords.slice(0, keywordsN).join(', ')}`)
      }
    })
    console.log('')
  }

  if (result.topChangedPaths.length === 0) {
    console.log('No file drift information available.')
    return
  }

  console.log('Top semantically-drifted files:')
  for (const entry of result.topChangedPaths) {
    const label = driftLabel(entry.semanticDrift)
    console.log(
      `  ${entry.path.padEnd(55)} — drift: ${entry.semanticDrift.toFixed(3)} (${label})`,
    )
  }
}
