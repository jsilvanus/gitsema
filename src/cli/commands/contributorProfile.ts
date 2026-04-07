import { writeFileSync } from 'node:fs'
import { computeContributorProfile } from '../../core/search/contributorProfile.js'
import { renderResults } from '../../core/search/ranking.js'
import { resolveOutputs, hasSinkFormat, getSink } from '../../utils/outputSink.js'

export interface ContributorProfileOptions {
  top?: string
  branch?: string
  dump?: string | boolean
  out?: string[]
}

export async function contributorProfileCommand(author: string, options: ContributorProfileOptions): Promise<void> {
  if (!author || author.trim() === '') {
    console.error('Error: author is required')
    process.exit(1)
  }

  const topK = options.top !== undefined ? parseInt(options.top, 10) : 10
  if (isNaN(topK) || topK < 1) {
    console.error('Error: --top must be a positive integer')
    process.exit(1)
  }

  let results: any[] = []
  try {
    results = await computeContributorProfile(author, { topK, branch: options.branch })
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const sinks = resolveOutputs({ out: options.out, dump: options.dump, html: undefined })
  const jsonSink = getSink(sinks, 'json')

  if (jsonSink) {
    const json = JSON.stringify(results, null, 2)
    if (jsonSink.file) {
      writeFileSync(jsonSink.file, json, 'utf8')
      console.log(`Wrote contributor-profile JSON to ${jsonSink.file}`)
    } else {
      process.stdout.write(json + '\n')
      return
    }
    if (!hasSinkFormat(sinks, 'text')) return
  }

  // Render as search results
  console.log(`Contributor semantic profile for: ${author}\n`)
  if (results.length === 0) {
    console.log('No embeddings found for this author or no blobs indexed.')
    return
  }
  console.log(renderResults(results as any))
}
