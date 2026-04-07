import { computeDiff } from '../../core/search/evolution.js'
import { shortHash } from '../../core/search/ranking.js'
import { writeFileSync } from 'node:fs'
import { narrateDiff } from '../../core/llm/narrator.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface DiffCommandOptions {
  neighbors?: string
  dump?: string | boolean
  narrate?: boolean
  out?: string[]
}

/**
 * Renders a semantic diff result as human-readable CLI output.
 */
function renderDiff(
  result: Awaited<ReturnType<typeof computeDiff>>,
  filePath: string,
): string {
  const lines: string[] = []
  lines.push(`Semantic diff: ${filePath}`)
  lines.push(`  ref1: ${result.ref1}  blob: ${result.blobHash1 ? shortHash(result.blobHash1) : '(not found)'}`)
  lines.push(`  ref2: ${result.ref2}  blob: ${result.blobHash2 ? shortHash(result.blobHash2) : '(not found)'}`)

  if (result.cosineDistance === null) {
    if (!result.blobHash1 || !result.blobHash2) {
      lines.push('\n  One or both versions are not present in the index.')
      lines.push('  Run `gitsema index` first to ensure both commits are indexed.')
    } else {
      lines.push('\n  Could not compute distance — embeddings not found for one or both blobs.')
    }
    return lines.join('\n')
  }

  lines.push(`\n  Cosine distance: ${result.cosineDistance.toFixed(4)}`)

  const description =
    result.cosineDistance < 0.05
      ? 'virtually identical'
      : result.cosineDistance < 0.15
        ? 'minor drift'
        : result.cosineDistance < 0.35
          ? 'moderate change'
          : result.cosineDistance < 0.6
            ? 'significant rewrite'
            : 'complete semantic overhaul'
  lines.push(`  Interpretation: ${description}`)

  if (result.neighbors1 && result.neighbors1.length > 0) {
    lines.push(`\n  Nearest neighbours of ${result.ref1} version:`)
    for (const n of result.neighbors1) {
      const pathStr = n.paths[0] ?? '(unknown path)'
      lines.push(`    ${n.distance.toFixed(4)}  ${pathStr}  [${shortHash(n.blobHash)}]`)
    }
  }

  if (result.neighbors2 && result.neighbors2.length > 0) {
    lines.push(`\n  Nearest neighbours of ${result.ref2} version:`)
    for (const n of result.neighbors2) {
      const pathStr = n.paths[0] ?? '(unknown path)'
      lines.push(`    ${n.distance.toFixed(4)}  ${pathStr}  [${shortHash(n.blobHash)}]`)
    }
  }

  return lines.join('\n')
}

export async function diffCommand(
  ref1: string,
  ref2: string,
  filePath: string,
  options: DiffCommandOptions,
): Promise<void> {
  if (!filePath || filePath.trim() === '') {
    console.error('Error: file path is required')
    process.exit(1)
  }

  let neighbors = 0
  if (options.neighbors !== undefined) {
    neighbors = parseInt(options.neighbors, 10)
    if (isNaN(neighbors) || neighbors < 0) {
      console.error('Error: --neighbors must be a non-negative integer')
      process.exit(1)
    }
  }

  const result = await computeDiff(ref1, ref2, filePath.trim(), { neighbors })

  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: undefined })
  const jsonSink = getSink(sinks, 'json')

  if (jsonSink) {
    const json = JSON.stringify(result, null, 2)
    if (jsonSink.file) {
      try {
        writeFileSync(jsonSink.file, json, 'utf8')
        console.log(`Diff JSON written to: ${jsonSink.file}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error writing dump file: ${msg}`)
        process.exit(1)
      }
    } else {
      process.stdout.write(json + '\n')
      return
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  console.log(renderDiff(result, filePath.trim()))

  if (options.narrate) {
    console.log('')
    console.log('=== LLM Diff Narrative ===')
    const narrative = await narrateDiff(filePath.trim(), result)
    console.log(narrative)
  }
}
