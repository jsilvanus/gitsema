import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTool } from '../registerTool.js'
import { computeEvolution, computeConceptEvolution } from '../../core/search/evolution.js'
import { computeSemanticDiff } from '../../core/search/semanticDiff.js'
import { computeSemanticBlame } from '../../core/search/semanticBlame.js'
import { getBlobContent } from '../../core/indexing/blobStore.js'
import { formatDate, renderResults } from '../../core/search/ranking.js'
import { parseDateArg } from '../../core/search/timeSearch.js'
import { getTextProvider } from '../../core/embedding/providerFactory.js'
import { computeSemanticCollisions, computeMergeImpact } from '../../core/search/mergeAudit.js'
import { computeBranchSummary } from '../../core/search/branchSummary.js'
import { computeConceptChangePoints, computeFileChangePoints } from '../../core/search/changePoints.js'
import { computeAuthorContributions } from '../../core/search/authorSearch.js'
import { computeExperts } from '../../core/search/experts.js'
import { computeImpact } from '../../core/search/impact.js'
import { findDeadConcepts } from '../../core/search/deadConcepts.js'
import { scanForVulnerabilities } from '../../core/search/securityScan.js'
import { computeHealthTimeline } from '../../core/search/healthTimeline.js'
import { scoreDebt } from '../../core/search/debtScoring.js'
import { computeDocGap } from '../../core/search/docGap.js'
import { computeContributorProfile } from '../../core/search/contributorProfile.js'
import { computeOwnershipHeatmap } from '../../core/search/ownershipHeatmap.js'
import { vectorSearch } from '../../core/search/vectorSearch.js'
import { getActiveSession } from '../../core/db/sqlite.js'

export function registerAnalysisTools(server: McpServer) {
  // evolution
  registerTool(
    server,
    'evolution',
    "Track how a file's semantic content has drifted over time. Returns a human-readable timeline by default, or a structured JSON dump when structured=true.",
    {
      path: z.string().describe('File path relative to the repo root, e.g. "src/auth/oauth.ts"'),
      threshold: z.number().min(0).max(2).optional().default(0.3).describe('Cosine distance threshold above which a version is flagged as a large change'),
      structured: z.boolean().optional().default(false).describe('Return structured JSON with full timeline data instead of human-readable text (useful for agent processing)'),
      include_content: z.boolean().optional().default(false).describe('Include the stored file content for each version in the structured output (only used when structured=true)'),
    },
    async ({ path, threshold, structured, include_content }) => {
      const entries = computeEvolution(path)

      if (entries.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No history found for: ${path}\nHas this file been indexed? Run the index tool or ` + '`gitsema index`' + ` first.`,
            },
          ],
        }
      }

      if (structured) {
        const data = {
          path,
          versions: entries.length,
          threshold,
          timeline: entries.map((e, i) => {
            const entry: Record<string, unknown> = {
              index: i,
              date: formatDate(e.timestamp),
              timestamp: e.timestamp,
              blobHash: e.blobHash,
              commitHash: e.commitHash,
              distFromPrev: e.distFromPrev,
              distFromOrigin: e.distFromOrigin,
              isOrigin: i === 0,
              isLargeChange: i > 0 && e.distFromPrev >= threshold,
            }
            if (include_content) {
              entry.content = getBlobContent(e.blobHash) ?? null
            }
            return entry
          }),
          summary: {
            largeChanges: entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length,
            maxDistFromPrev: Math.max(...entries.map((e) => e.distFromPrev), 0),
            totalDrift: entries[entries.length - 1].distFromOrigin,
          },
        }
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      }

      const lines = entries.map((e, i) => {
        const date = formatDate(e.timestamp)
        const blob = e.blobHash.slice(0, 7)
        const commit = e.commitHash.slice(0, 7)
        const dPrev = e.distFromPrev.toFixed(4)
        const dOrigin = e.distFromOrigin.toFixed(4)
        const note = i === 0 ? '  (origin)' : e.distFromPrev >= threshold ? '  ← large change' : ''
        return `${date}  blob:${blob}  commit:${commit}  dist_prev=${dPrev}  dist_origin=${dOrigin}${note}`
      })

      return {
        content: [{ type: 'text', text: `Evolution of ${path}:\n\n${lines.join('\n')}` }],
      }
    },
  )

  // concept_evolution
  registerTool(
    server,
    'concept_evolution',
    'Show how a semantic concept (e.g. "authentication") has evolved across the commit history.',
    {
      query: z.string().describe('Natural-language concept to trace, e.g. "authentication" or "error handling"'),
      top_k: z.number().int().positive().optional().default(50).describe('Number of top-matching blobs to include in the timeline'),
      threshold: z.number().min(0).max(2).optional().default(0.3).describe('Cosine distance threshold above which a step is flagged as a large change'),
      structured: z.boolean().optional().default(false).describe('Return structured JSON instead of human-readable text (useful for agent processing)'),
      include_content: z.boolean().optional().default(false).describe('Include stored file content for each entry in the structured output (only used when structured=true)'),
    },
    async ({ query, top_k, threshold, structured, include_content }, { embed }) => {
      const provider = getTextProvider()
      const qRes = await embed(provider, query, 'Error embedding query')
      if (!qRes.ok) return qRes.resp
      const queryEmbedding = qRes.embedding!

      const entries = computeConceptEvolution(queryEmbedding, top_k)

      if (entries.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No matching blobs found for: "${query}"\nHas the index been built? Run the index tool or ` + '`gitsema index`' + ` first.`,
            },
          ],
        }
      }

      if (structured) {
        const data = {
          query,
          entries: entries.length,
          threshold,
          timeline: entries.map((e, i) => {
            const item: Record<string, unknown> = {
              index: i,
              date: formatDate(e.timestamp),
              timestamp: e.timestamp,
              blobHash: e.blobHash,
              commitHash: e.commitHash,
              paths: e.paths,
              score: e.score,
              distFromPrev: e.distFromPrev,
              isOrigin: i === 0,
              isLargeChange: i > 0 && e.distFromPrev >= threshold,
            }
            if (include_content) {
              item.content = getBlobContent(e.blobHash) ?? null
            }
            return item
          }),
          summary: {
            largeChanges: entries.filter((e, i) => i > 0 && e.distFromPrev >= threshold).length,
            maxDistFromPrev: Math.max(...entries.map((e) => e.distFromPrev), 0),
            avgScore: entries.reduce((sum, e) => sum + e.score, 0) / entries.length,
          },
        }
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      }

      const lines = entries.map((e, i) => {
        const date = formatDate(e.timestamp)
        const path = (e.paths[0] ?? '(unknown path)').padEnd(50)
        const blob = e.blobHash.slice(0, 7)
        const score = e.score.toFixed(3)
        const dPrev = e.distFromPrev.toFixed(4)
        const note = i === 0 ? '  (origin)' : e.distFromPrev >= threshold ? '  ← large change' : ''
        return `${date}  ${path}  [${blob}]  score=${score}  dist_prev=${dPrev}${note}`
      })

      return {
        content: [
          {
            type: 'text',
            text: `Concept evolution: "${query}"\nEntries found: ${entries.length}\n\n${lines.join('\n')}`,
          },
        ],
      }
    },
  )

  // branch_summary
  registerTool(
    server,
    'branch_summary',
    'Generate a semantic summary of what a branch is about compared to its base branch. Shows the nearest concept clusters and the files with the highest semantic drift.',
    {
      branch: z.string().describe('Branch to summarise (short name, e.g. "feature/auth")'),
      base_branch: z.string().optional().default('main').describe('Base branch to compare against (default "main")'),
      top_concepts: z.number().int().positive().optional().default(5).describe('Number of nearest concept clusters to return'),
    },
    async ({ branch, base_branch, top_concepts }) => {
      try {
        const result = await computeBranchSummary(branch, base_branch, { topConcepts: top_concepts })

        if (result.exclusiveBlobCount === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Branch "${branch}" has no exclusive blobs compared to "${base_branch}" (merge base: ${result.mergeBase.slice(0, 8)}).\nEnsure the branch is indexed with the index tool first.`,
              },
            ],
          }
        }

        const lines = [
          `Branch summary: ${result.branch} vs ${result.baseBranch}`,
          `Merge base: ${result.mergeBase.slice(0, 8)}`,
          `Exclusive blobs: ${result.exclusiveBlobCount}`,
          '',
        ]

        if (result.nearestConcepts.length > 0) {
          lines.push('This branch is semantically about:')
          for (const [i, c] of result.nearestConcepts.entries()) {
            lines.push(`  ${i + 1}. "${c.clusterLabel}"  (similarity: ${c.similarity.toFixed(3)})`)
          }
          lines.push('')
        } else {
          lines.push('No concept clusters available. Run gitsema clusters first.')
          lines.push('')
        }

        if (result.topChangedPaths.length > 0) {
          lines.push('Top semantically-drifted files:')
          for (const entry of result.topChangedPaths) {
            lines.push(`  ${entry.path}  (drift: ${entry.semanticDrift.toFixed(3)})`)
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // merge_audit
  registerTool(
    server,
    'merge_audit',
    'Detect semantic collisions between two branches — pairs of files that are about the same concept even if they don\'t share lines.',
    {
      branch_a: z.string().describe('First branch name (e.g. "feature/auth")'),
      branch_b: z.string().describe('Second branch name (e.g. "feature/payments")'),
      base_commit: z.string().optional().describe('Override merge-base detection with this commit hash or ref'),
      threshold: z.number().min(0).max(1).optional().default(0.85).describe('Cosine similarity threshold for a collision (0–1, default 0.85)'),
      top_k: z.number().int().positive().optional().default(20).describe('Maximum collision pairs to return'),
    },
    async ({ branch_a, branch_b, base_commit, threshold, top_k }) => {
      try {
        let mergeBase: string
        if (base_commit) {
          mergeBase = base_commit
        } else {
          mergeBase = (await import('../../core/git/branchDiff.js')).getMergeBase(branch_a, branch_b)
        }

        const { getBranchExclusiveBlobs } = await import('../../core/git/branchDiff.js')
        const blobsA = getBranchExclusiveBlobs(branch_a, mergeBase)
        const blobsB = getBranchExclusiveBlobs(branch_b, mergeBase)

        const report = computeSemanticCollisions(blobsA, blobsB, branch_a, branch_b, mergeBase, {
          threshold,
          topK: top_k,
        })

        const lines = [
          `Merge audit: ${report.branchA} ↔ ${report.branchB}`,
          `Merge base: ${report.mergeBase.slice(0, 8)}`,
          `Branch A exclusive blobs: ${report.blobCountA}`,
          `Branch B exclusive blobs: ${report.blobCountB}`,
          `Centroid similarity: ${report.centroidSimilarity >= 0 ? report.centroidSimilarity.toFixed(3) : 'n/a'}`,
          `Collisions found: ${report.collisionPairs.length}`,
          '',
        ]

        if (report.collisionZones.length > 0) {
          lines.push('Collision zones:')
          for (const z of report.collisionZones) {
            lines.push(`  "${z.clusterLabel}" — ${z.pairCount} pair(s)`)
          }
          lines.push('')
        }

        if (report.collisionPairs.length > 0) {
          lines.push('Top collision pairs:')
          for (const pair of report.collisionPairs.slice(0, 10)) {
            const pathA = pair.blobA.paths[0] ?? pair.blobA.hash.slice(0, 7)
            const pathB = pair.blobB.paths[0] ?? pair.blobB.hash.slice(0, 7)
            lines.push(`  ${pair.similarity.toFixed(3)}  ${pathA}  ↔  ${pathB}`)
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // merge_preview
  registerTool(
    server,
    'merge_preview',
    'Predict how the semantic concept landscape will shift after merging a branch. Returns the same cluster diff report as cluster-diff but driven by branch-exclusive blobs rather than timestamps.',
    {
      branch: z.string().describe('Branch to merge (e.g. "feature/auth")'),
      into: z.string().optional().default('main').describe('Target branch to merge into (default "main")'),
      k: z.number().int().positive().optional().default(8).describe('Number of semantic clusters to compute'),
    },
    async ({ branch, into, k }) => {
      try {
        const report = await computeMergeImpact(branch, into, { k })

        const lines = [
          `Merge preview: ${branch} → ${into}`,
          `Base blobs: ${report.before.totalBlobs}  |  Post-merge blobs: ${report.after.totalBlobs}`,
          `Changes: ${report.newBlobsTotal} new, ${report.removedBlobsTotal} removed, ${report.movedBlobsTotal} moved, ${report.stableBlobsTotal} stable`,
          '',
          'Predicted cluster changes:',
        ]

        for (const change of report.changes) {
          const after = change.afterCluster
          const before = change.beforeCluster
          if (after !== null && before !== null) {
            lines.push(
              `  "${after.label}"  drift: ${change.centroidDrift.toFixed(3)}  new: ${change.newBlobs}  stable: ${change.stable}`,
            )
          } else if (after !== null) {
            lines.push(`  "${after.label}"  [NEW]  ${after.size} blobs`)
          } else if (before !== null) {
            lines.push(`  "${before.label}"  [DISSOLVED]`)
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // change_points
  registerTool(
    server,
    'change_points',
    'Find the historical moments when a semantic concept underwent its largest shifts across the codebase.',
    {
      query: z.string().describe('Natural-language concept to track'),
      top_k: z.number().int().positive().optional().default(50).describe('Number of top-matching blobs to scan'),
      threshold: z.number().min(0).max(2).optional().default(0.3).describe('Cosine distance threshold for flagging a change point'),
      top_points: z.number().int().positive().optional().default(5).describe('Number of change points to return'),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ query, top_k, threshold, top_points, branch }, { embed }) => {
      try {
        const provider = getTextProvider()
        const qRes = await embed(provider, query, 'Error embedding query')
        if (!qRes.ok) return qRes.resp
        const queryEmbedding = qRes.embedding!
        const report = computeConceptChangePoints(query, queryEmbedding, { topK: top_k, threshold, topPoints: top_points, branch })
        if (report.points.length === 0) {
          return { content: [{ type: 'text', text: 'No change points found above threshold.' }] }
        }
        const lines = [`Change points for: "${query}"  (threshold: ${threshold})\n`]
        for (const pt of report.points) {
          lines.push(`  ${pt.after.date}  dist: ${pt.distance.toFixed(3)}  before: [${pt.before.commit.slice(0, 7)}] → after: [${pt.after.commit.slice(0, 7)}]`)
          const path = pt.after.topPaths[0] ?? pt.before.topPaths[0] ?? '(unknown path)'
          lines.push(`    ${path}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // experts
  registerTool(
    server,
    'experts',
    'List top contributors by semantic area (which concepts/clusters they work on).',
    {
      top_n: z.number().int().positive().optional().default(10).describe('Number of top contributors to return'),
      since: z.string().optional().describe('Only include activity after this date (YYYY-MM-DD)'),
      until: z.string().optional().describe('Only include activity before this date (YYYY-MM-DD)'),
      min_blobs: z.number().int().positive().optional().default(1).describe('Minimum blob count to include a contributor'),
      top_clusters: z.number().int().positive().optional().default(5).describe('Max semantic clusters per contributor'),
    },
    async ({ top_n, since, until, min_blobs, top_clusters }) => {
      let sinceTs: number | undefined
      let untilTs: number | undefined
      if (since) sinceTs = parseDateArg(since)
      if (until) untilTs = parseDateArg(until)
      const experts = computeExperts({ topN: top_n, since: sinceTs, until: untilTs, minBlobs: min_blobs, topClusters: top_clusters })
      if (experts.length === 0) return { content: [{ type: 'text', text: 'No contributor data found.' }] }
      const lines: string[] = []
      for (const e of experts) {
        lines.push(`${e.authorName}${e.authorEmail ? ` <${e.authorEmail}>` : ''} — ${e.blobCount} blob(s)`)
        for (const c of e.clusters) {
          lines.push(`  · ${c.label} [${c.blobCount}]${c.representativePaths.length > 0 ? ` (${c.representativePaths.slice(0, 2).join(', ')})` : ''}`)
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )

  // semantic_diff
  registerTool(
    server,
    'semantic_diff',
    'Compute a conceptual/semantic diff of a topic across two git refs — shows gained, lost, and stable concepts.',
    {
      ref1: z.string().describe('Earlier git ref (branch, tag, commit hash, or date)'),
      ref2: z.string().describe('Later git ref'),
      query: z.string().describe('Topic query to embed and compare'),
      top_k: z.number().int().positive().optional().default(10),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ ref1, ref2, query, top_k, branch }, { embed }) => {
      try {
        const provider = getTextProvider()
        const qRes = await embed(provider, query, 'Error embedding query')
        if (!qRes.ok) return qRes.resp
        const qEmb = qRes.embedding!
        const result = computeSemanticDiff(qEmb, query, ref1, ref2, top_k, branch)
        const lines: string[] = []
        lines.push(`Semantic diff: "${result.topic}"`)
        lines.push(`ref1: ${result.ref1}  (${result.timestamp1 ? formatDate(result.timestamp1) : 'unknown'})`)
        lines.push(`ref2: ${result.ref2}  (${result.timestamp2 ? formatDate(result.timestamp2) : 'unknown'})`)
        lines.push('')
        const render = (label: string, list: any[]) => {
          lines.push(`${label}:`)
          if (list.length === 0) lines.push('  (none)')
          for (const e of list) {
            const p = e.paths[0] ?? '(unknown)'
            lines.push(`  ${formatDate(e.firstSeen)}  ${p}  [${e.blobHash.slice(0,7)}]  score=${e.score.toFixed(3)}`)
          }
          lines.push('')
        }
        render('Gained', result.gained)
        render('Lost', result.lost)
        render('Stable', result.stable)
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // semantic_blame
  registerTool(
    server,
    'semantic_blame',
    'Show semantic origin of each logical block in a file — finds nearest-neighbor blobs in the index.',
    {
      file_path: z.string().describe('Path to the file to blame'),
      top_k: z.number().int().positive().optional().default(3),
      level: z.enum(['file', 'symbol']).optional().default('file'),
      branch: z.string().optional(),
    },
    async ({ file_path, top_k, level, branch }) => {
      try {
        const provider = getTextProvider()
        const content = getBlobContent(file_path) ?? ''
        if (!content) return { content: [{ type: 'text', text: `File not found in blob store: ${file_path}` }] }
        const entries = await computeSemanticBlame(file_path, content, provider, { topK: top_k, searchSymbols: level === 'symbol', branch })
        if (entries.length === 0) return { content: [{ type: 'text', text: '(no entries)' }] }
        const lines: string[] = [`Semantic blame: ${file_path}`, '']
        for (const entry of entries) {
          lines.push(`─ ${entry.label} (lines ${entry.startLine}–${entry.endLine})`)
          if (entry.neighbors.length === 0) {
            lines.push('  (no indexed blobs)')
            lines.push('')
            continue
          }
          for (const n of entry.neighbors) {
            lines.push(`  ${n.similarity.toFixed(3)}  ${n.paths[0] ?? '(unknown)'}  [${n.blobHash.slice(0,7)}]`)
            if (n.commitHash) lines.push(`    commit: ${n.commitHash.slice(0,7)}  (${n.timestamp ? formatDate(n.timestamp) : 'unknown'})`)
            if (n.author) lines.push(`    author: ${n.author}`)
            if (n.message) lines.push(`    message: ${n.message.split('\n')[0]}`)
          }
          lines.push('')
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // file_change_points
  registerTool(
    server,
    'file_change_points',
    "Detect semantic change points in a file's Git history.",
    {
      path: z.string().describe('File path to analyze'),
      threshold: z.number().min(0).max(2).optional().default(0.3).describe('Cosine distance threshold to emit a change point'),
      top_points: z.number().int().positive().optional().default(5).describe('Number of change points to return'),
      branch: z.string().optional(),
    },
    async ({ path, threshold, top_points, branch }) => {
      try {
        const report = computeFileChangePoints(path, { threshold, topPoints: top_points, branch })
        if (report.points.length === 0) return { content: [{ type: 'text', text: '(no change points found)' }] }
        const lines = [`File change points for: ${path}`, '']
        for (const p of report.points) {
          lines.push(`  ${p.before.date} → ${p.after.date}  dist=${p.distance.toFixed(3)}  ${p.before.blobHash.slice(0,7)} → ${p.after.blobHash.slice(0,7)}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // author
  registerTool(
    server,
    'author',
    'Find which authors have contributed most to a semantic concept in the codebase.',
    {
      query: z.string().describe('Natural-language concept to attribute'),
      top_k: z.number().int().positive().optional().default(50).describe('Number of top blobs to attribute'),
      top_authors: z.number().int().positive().optional().default(10).describe('Number of top authors to return'),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ query, top_k, top_authors, branch }, { embed }) => {
      try {
        const provider = getTextProvider()
        const qRes = await embed(provider, query, 'Error embedding query')
        if (!qRes.ok) return qRes.resp
        const queryEmbedding = qRes.embedding!
        const contributions = await computeAuthorContributions(queryEmbedding, { topK: top_k, topAuthors: top_authors, branch })
        if (contributions.length === 0) {
          return { content: [{ type: 'text', text: 'No author contributions found.' }] }
        }
        const lines = [`Authors for: "${query}"\n`]
        for (const c of contributions) {
          lines.push(`  ${c.authorName} <${c.authorEmail}>  score: ${c.totalScore.toFixed(3)}  blobs: ${c.blobCount}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // impact
  registerTool(
    server,
    'impact',
    'Find blobs most semantically coupled to a file — shows what else in the codebase will be affected by changes to that file.',
    {
      file: z.string().describe('Path to the file to analyse (relative to repo root)'),
      top_k: z.number().int().positive().optional().default(10).describe('Number of similar blobs to return'),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ file, top_k, branch }) => {
      try {
        const provider = getTextProvider()
        const report = await computeImpact(file, provider, { topK: top_k, branch })
        if (report.results.length === 0) {
          return { content: [{ type: 'text', text: `No semantically coupled blobs found for: ${file}` }] }
        }
        const lines = [`Impact analysis: ${file}  (${report.results.length} neighbors)\n`]
        for (const n of report.results) {
          const path = n.paths[0] ?? '(unknown path)'
          lines.push(`  ${n.score.toFixed(3)}  ${path}  [${n.blobHash.slice(0, 7)}]`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // dead_concepts
  registerTool(
    server,
    'dead_concepts',
    'Find blobs that existed historically but are no longer reachable from HEAD — deleted or removed concepts.',
    {
      top_k: z.number().int().positive().optional().default(10).describe('Number of dead blobs to return'),
      branch: z.string().optional().describe('Restrict to blobs seen on this branch'),
    },
    async ({ top_k, branch }) => {
      try {
        const results = await findDeadConcepts({ topK: top_k, branch })
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No dead concepts found.' }] }
        }
        const lines = [`Dead concepts (${results.length} found):\n`]
        for (const r of results) {
          const path = r.paths[0] ?? '(unknown path)'
          const date = r.lastSeenDate !== null ? formatDate(r.lastSeenDate) : 'unknown date'
          lines.push(`  ${r.score.toFixed(3)}  ${path}  last seen: ${date}`)
          if (r.lastSeenMessage) lines.push(`    commit: ${r.lastSeenMessage}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // security_scan
  registerTool(
    server,
    'security_scan',
    'Scan the codebase for blobs semantically similar to common vulnerability patterns.\n⚠️ Results are similarity scores, NOT confirmed vulnerabilities.',
    {
      top: z.number().int().positive().optional().default(10).describe('Number of results per pattern'),
    },
    async ({ top }) => {
      try {
        const provider = getTextProvider()
        const session = getActiveSession()
        const findings = await scanForVulnerabilities(session, provider, { top })
        if (findings.length === 0) {
          return { content: [{ type: 'text', text: '⚠️ Semantic similarity scan only — not confirmed vulnerabilities.\nNo high-similarity blobs found for any vulnerability pattern.' }] }
        }
        const lines = ['⚠️ Results are semantic similarity scores, NOT confirmed vulnerabilities. Manual review required.\n']
        for (const f of findings) {
          const path = f.paths[0] ?? '(unknown path)'
          lines.push(`[${f.patternName}]  score=${f.score.toFixed(3)}  ${path}  [${f.blobHash.slice(0, 7)}]`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // health_timeline
  registerTool(
    server,
    'health_timeline',
    'Show time-bucketed codebase health metrics: active blob count, semantic churn rate, and dead-concept ratio per period.',
    {
      buckets: z.number().int().positive().optional().default(12).describe('Number of time buckets'),
      branch: z.string().optional().describe('Restrict to commits on this branch'),
    },
    async ({ buckets, branch }) => {
      try {
        const session = getActiveSession()
        const snaps = computeHealthTimeline(session, { buckets, branch })
        if (snaps.length === 0) {
          return { content: [{ type: 'text', text: 'No commits found in the index.' }] }
        }
        const lines = [`Health timeline (${snaps.length} buckets):\n`]
        for (const s of snaps) {
          const start = new Date(s.periodStart * 1000).toISOString().slice(0, 10)
          const end = new Date(s.periodEnd * 1000).toISOString().slice(0, 10)
          lines.push(`  ${start}–${end}  active=${s.activeBlobCount}  churn=${s.semanticChurnRate.toFixed(3)}  dead=${s.deadConceptRatio.toFixed(3)}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // debt_score
  registerTool(
    server,
    'debt_score',
    'Score blobs by technical debt: isolation (semantic distance from neighbours), age, and low change frequency.',
    {
      top: z.number().int().positive().optional().default(20).describe('Number of top-debt blobs to return'),
      branch: z.string().optional().describe('Restrict to blobs on this branch'),
    },
    async ({ top, branch }) => {
      try {
        const provider = getTextProvider()
        const session = getActiveSession()
        const model = process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
        const results = await scoreDebt(session, provider, { top, branch, model })
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No blobs found.' }] }
        }
        const lines = [`Top-${results.length} debt blobs:\n`]
        for (const r of results) {
          const path = r.paths[0] ?? '(unknown path)'
          lines.push(`  ${r.debtScore.toFixed(3)}  ${path.padEnd(50)}  isolation=${r.isolationScore.toFixed(3)}  age=${r.ageScore.toFixed(3)}  chg=${r.changeFrequency}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // doc_gap
  registerTool(
    server,
    'doc_gap',
    'Find code blobs with insufficient documentation coverage: returns code files with the lowest semantic similarity to any documentation blob in the index.',
    {
      top_k: z.number().int().positive().optional().default(20).describe('Number of underdocumented blobs to return'),
      threshold: z.number().min(0).max(1).optional().describe('Maximum doc-similarity to include (lower = less documented)'),
      branch: z.string().optional().describe('Restrict to blobs on this branch'),
    },
    async ({ top_k, threshold, branch }) => {
      try {
        const results = await computeDocGap({ topK: top_k, threshold, branch })
        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No underdocumented blobs found.' }] }
        }
        const lines = results.map((r) => {
          const path = r.paths[0] ?? r.blobHash.slice(0, 8)
          return `${r.maxDocSimilarity.toFixed(3)}  ${path}`
        })
        return { content: [{ type: 'text', text: `Top underdocumented blobs (by doc-similarity):\n${lines.join('\n')}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // contributor_profile
  registerTool(
    server,
    'contributor_profile',
    'Show what a contributor specialises in: returns the top blobs most similar to the semantic centroid of all blobs touched by the author.',
    {
      author: z.string().describe('Author name or email (substring match)'),
      top_k: z.number().int().positive().optional().default(10).describe('Number of blobs to return'),
      branch: z.string().optional().describe('Restrict to blobs on this branch'),
    },
    async ({ author, top_k, branch }) => {
      try {
        const results = await computeContributorProfile(author, { topK: top_k, branch })
        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No contributions found for author: ${author}` }] }
        }
        const lines = results.map((r: any) => {
          const path = (r.paths?.[0] ?? r.blobHash?.slice(0, 8) ?? '?')
          const score = typeof r.score === 'number' ? r.score.toFixed(3) : '?'
          return `${score}  ${path}`
        })
        return { content: [{ type: 'text', text: `Contributor profile for ${author}:\n${lines.join('\n')}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // ownership
  registerTool(
    server,
    'ownership',
    'Show ownership heatmap for a semantic concept: for a query, ranks authors by their share of touched blobs in the matching concept area.',
    {
      query: z.string().describe('Natural-language concept query'),
      top: z.number().int().positive().optional().default(5).describe('Number of top owners to return'),
      window_days: z.number().int().positive().optional().default(90).describe('Time window for recent activity (days)'),
    },
    async ({ query, top, window_days }, { embed }) => {
      const provider = getTextProvider()
      const eRes = await embed(provider, query, 'Error embedding query')
      if (!eRes.ok) return eRes.resp
      const emb = eRes.embedding!
      try {
        const heatmap = computeOwnershipHeatmap({ embedding: emb, topK: top, windowDays: window_days })
        if (heatmap.length === 0) {
          return { content: [{ type: 'text', text: 'No ownership data found.' }] }
        }
        const lines = heatmap.map((o: any) => `${(o.share ?? 0).toFixed(3)}  ${o.author ?? o.authorEmail ?? '?'}`)
        return { content: [{ type: 'text', text: `Ownership for "${query}":\n${lines.join('\n')}` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  // eval
  registerTool(
    server,
    'eval',
    'Retrieval evaluation harness: given a list of (query, expectedPaths) test cases, returns precision@k, recall@k, and MRR metrics for the current index state.',
    {
      cases: z.array(z.object({
        query: z.string().describe('Search query'),
        expected_paths: z.array(z.string()).describe('Expected file paths in the top-k results'),
      })).min(1).describe('Evaluation test cases'),
      top: z.number().int().positive().optional().default(10).describe('k for P@k / R@k'),
    },
    async ({ cases, top }, { embed }) => {
      const provider = getTextProvider()
      let sumPrecision = 0
      let sumRecall = 0
      let sumMrr = 0
      const caseResults: Array<{ query: string; precision: number; recall: number; mrr: number }> = []

      for (const c of cases) {
        const eRes = await embed(provider, c.query, 'Error embedding query')
        if (!eRes.ok) {
          caseResults.push({ query: c.query, precision: 0, recall: 0, mrr: 0 })
          continue
        }
        const emb = eRes.embedding!
        const hits = vectorSearch(emb, { topK: top })
        const topPaths = hits.flatMap((h) => h.paths ?? []).slice(0, top)
        const expected = new Set(c.expected_paths)
        const hits_ = topPaths.filter((p) => expected.has(p))
        const precision = topPaths.length > 0 ? hits_.length / topPaths.length : 0
        const recall = expected.size > 0 ? hits_.length / expected.size : 1
        let mrr = 0
        for (let i = 0; i < topPaths.length; i++) {
          if (expected.has(topPaths[i])) { mrr = 1 / (i + 1); break }
        }
        sumPrecision += precision; sumRecall += recall; sumMrr += mrr
        caseResults.push({ query: c.query, precision, recall, mrr })
      }

      const n = cases.length
      const lines = [
        `Eval results (n=${n}, top=${top}):`,
        `  P@${top}: ${(sumPrecision / n).toFixed(3)}`,
        `  R@${top}: ${(sumRecall / n).toFixed(3)}`,
        `  MRR:   ${(sumMrr / n).toFixed(3)}`,
        '',
        'Per-case:',
        ...caseResults.map((r) => `  P=${r.precision.toFixed(3)} R=${r.recall.toFixed(3)} MRR=${r.mrr.toFixed(3)}  "${r.query}"`),
      ]
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )
}
