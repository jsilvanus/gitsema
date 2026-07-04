/**
 * Tool interpretation registry — the SINGLE SOURCE OF TRUTH for how to read the
 * output of every gitsema capability.
 *
 * Each entry pairs a capability with (a) a one-line summary, (b) a description of
 * its result shape, and (c) interpretation guidance — "how to read these results":
 * what is significant, useful thresholds, caveats, and citation expectations.
 *
 * This registry feeds three consumers, so a single edit propagates everywhere:
 *   1. The `gitsema guide` agentic loop — `buildGuideToolCatalog()` is embedded in
 *      the guide system prompt so the LLM knows how to interpret each tool's output.
 *   2. The narrators — `buildNarratorSystemPrompt(name)` provides the per-tool
 *      "how to interpret" guidance used by `narrate`/`explain` (narrator.ts) and the
 *      result narrators (llm/narrator.ts), replacing previously-scattered hardcoded
 *      persona strings.
 *   3. The agent-facing skill — `scripts/gen-skill.mjs` regenerates the
 *      "Interpreting tool results" section of `skill/gitsema-ai-assistant.md` from
 *      this registry (a `docsSync` test guards against drift).
 *
 * INVARIANT: when a tool's output shape changes, update its entry here. The skill is
 * generated from this file and the narrators read it at runtime; nothing else needs
 * to change. See CLAUDE.md ("Tool interpretations") for the workflow.
 *
 * ── TWO HALVES OF A TOOL'S PROMPT GUIDANCE ──────────────────────────────────
 * Each gitsema tool carries guidance in two complementary layers, kept in two
 * files on purpose:
 *
 *   • HOW TO USE (call it / what it does / what args) — lives with the tool's
 *     executable definition: `definition.description` + `parameters` in
 *     `src/core/narrator/guideTools.ts` (the guide agent loop) and the
 *     `registerTool(...)` description in `src/mcp/tools/*.ts` (the MCP server).
 *   • HOW TO READ IT (what the result means) — THIS FILE (`summary`,
 *     `resultShape`, `interpretation`).
 *
 * They are intentionally NOT merged: this registry is dependency-free prose so
 * the skill generator (`scripts/gen-skill.mjs`) and the narrators can import it
 * without pulling in `guideTools.ts`'s heavy executor dependency graph. The
 * `docsSync` test enforces the cross-file link (`GUIDE_TOOLS ⊆ this registry`).
 */

export type ToolCategory =
  | 'repo'
  | 'search'
  | 'history'
  | 'branch'
  | 'ownership'
  | 'quality'
  | 'diff'
  | 'clusters'
  | 'workflow'
  | 'admin'

export interface ToolInterpretation {
  /** Canonical capability name (matches the guide tool name). */
  name: string
  category: ToolCategory
  /** One-line description of what the capability does. */
  summary: string
  /** What the result payload contains. */
  resultShape: string
  /** How to read the results: what is significant, thresholds, caveats, citations. */
  interpretation: string
  /** Alternate names this capability is registered under (e.g. the MCP tool name). */
  aliases?: string[]
}

export const CATEGORY_ORDER: ToolCategory[] = [
  'repo',
  'search',
  'history',
  'branch',
  'ownership',
  'quality',
  'diff',
  'clusters',
  'workflow',
  'admin',
]

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  repo: 'Repository (git-only, no index required)',
  search: 'Search & discovery',
  history: 'History & temporal drift',
  branch: 'Branch & merge analysis',
  ownership: 'Ownership & expertise',
  quality: 'Quality, debt & risk',
  diff: 'Diff & blame',
  clusters: 'Clustering',
  workflow: 'Compound workflows',
  admin: 'Administration',
}

/**
 * Shared persona for every narrator/interpreter. Per-tool guidance is appended by
 * `buildNarratorSystemPrompt`.
 */
export const NARRATOR_BASE_PERSONA =
  'You are a precise software repository analyst. Be factual and concise, cite commit ' +
  'and blob hashes for every concrete claim, and clearly label anything that is an ' +
  'inference rather than direct evidence.'

export const TOOL_INTERPRETATIONS: Record<string, ToolInterpretation> = {
  // -------------------------------------------------------------------------
  // Repository (git-only)
  // -------------------------------------------------------------------------
  repo_stats: {
    name: 'repo_stats',
    category: 'repo',
    summary: 'Branch / tag / commit counts and configured remotes.',
    resultShape: '{ branches, tags, commits, remotes[] }.',
    interpretation:
      'A quick size/shape orientation for the repo. High commit counts with few branches suggest ' +
      'trunk-based development; many branches may indicate long-lived feature work. Use it to size ' +
      'follow-up queries (e.g. how far back to narrate).',
  },
  recent_commits: {
    name: 'recent_commits',
    category: 'repo',
    summary: 'The N most recent commits (hash, date, subject).',
    resultShape: '{ commits: [{ hash, date, subject }] }.',
    interpretation:
      'The latest activity. Subjects following conventional-commit prefixes (feat/fix/chore) hint at ' +
      'the change type. Cite the short hash when referencing any commit.',
  },
  narrate_repo: {
    name: 'narrate_repo',
    category: 'repo',
    summary: 'Structured commit evidence for a date range / focus (no LLM call inside).',
    resultShape: '{ commitCount, citations[], evidence: [{ hash, date, authorName, subject, body, tags[] }] }.',
    interpretation:
      'Raw, classified commit evidence — not a summary. `tags` group commits (bugfix, feature, ' +
      'security, deps, performance, ops). Build a narrative FROM this evidence and cite the hashes; ' +
      'do not assert anything the evidence does not support.',
    aliases: ['narrate'],
  },
  explain_topic: {
    name: 'explain_topic',
    category: 'repo',
    summary: 'Commits whose subject/body match a topic, for incident/feature investigation.',
    resultShape: '{ commitCount, citations[], evidence: [{ hash, date, subject, body, tags[] }] }.',
    interpretation:
      'Keyword-matched commit evidence for a topic — useful for "when was X introduced / fixed". ' +
      'Reconstruct a timeline (introduction → fixes → current status) from the matched commits and ' +
      'cite hashes; absence of matches is itself a signal (topic may be named differently).',
    aliases: ['explain', 'explain_issue_or_error'],
  },

  // -------------------------------------------------------------------------
  // Search & discovery
  // -------------------------------------------------------------------------
  semantic_search: {
    name: 'semantic_search',
    category: 'search',
    summary: 'Vector similarity search over indexed history.',
    resultShape: '{ query, results: [{ paths[], score, blobHash }] }.',
    interpretation:
      'Ranked by cosine similarity (0–1): roughly >0.75 is a strong match, 0.5–0.75 is related, ' +
      '<0.5 is weak. Each result is a content-addressed blob; the same blob can appear under several ' +
      'paths. Use the top paths as the most relevant files; cite the short blob hash. ' +
      'In text output, hashes appear as [blob:abc1234] — the "blob:" prefix marks these as blob hashes ' +
      '(content-addressed, internal), not commit hashes.',
  },
  code_search: {
    name: 'code_search',
    category: 'search',
    summary: 'Symbol/chunk-level search using the code embedding model.',
    resultShape:
      '{ snippet, results_by_level: { file: [...], chunk: [...], symbol: [...] } } by default — chunk ' +
      'and symbol pools are searched in isolation and returned as separate, independently-ranked lists ' +
      '(Phase 137). Pass merge_levels to get the pre-Phase-137 shape instead: ' +
      '{ snippet, results: [{ paths[], score, blobHash }] }.',
    interpretation:
      'Like semantic_search but embeds with the code model and targets symbols/chunks — better for ' +
      'finding specific functions/classes from a code snippet than from prose. Higher scores mean ' +
      "closer code-level similarity within a level's own list. Don't rank across levels by raw score — " +
      'chunk and symbol pools embed differently-framed text (raw excerpt vs. name+signature-annotated), ' +
      'so their scores are not on a directly comparable scale; read each level list separately.',
  },
  search_history: {
    name: 'search_history',
    category: 'search',
    summary: 'Semantic search enriched with first-seen date / commit, optionally date-sorted.',
    resultShape: 'Rendered "score  path  [blob:blobHash]  first: <date>" lines.',
    interpretation:
      'Use when the time dimension matters. Score still ranks relevance; the first-seen date tells you ' +
      'when that content entered history. Date-sorted output surfaces the earliest occurrences. ' +
      'The [blob:…] prefix identifies a blob hash (content-addressed) — not a commit hash.',
  },
  first_seen: {
    name: 'first_seen',
    category: 'search',
    summary: 'Find when a concept first appeared (results sorted earliest-first).',
    resultShape: 'Lines "<date>  path  [blob:blobHash]  (score: …)", oldest first.',
    interpretation:
      'The earliest dated row is the best evidence for a concept\'s origin, but only among ' +
      'semantically-matching blobs — confirm relevance via the score before claiming an origin date. ' +
      'Cite the date and short blob hash. The [blob:…] prefix identifies a blob hash (content-addressed) ' +
      '— not a commit hash.',
  },
  multi_repo_search: {
    name: 'multi_repo_search',
    category: 'search',
    summary: 'Semantic search across multiple registered gitsema repos.',
    resultShape: 'Lines "[repoId] score  path".',
    interpretation:
      'Same scoring as semantic_search but spanning repos registered via `gitsema repos add`. The ' +
      'repoId prefix tells you which repo each hit came from; compare scores across repos with care ' +
      'since indexes may use different models.',
  },
  cross_repo_similarity: {
    name: 'cross_repo_similarity',
    category: 'search',
    summary: 'Compare semantic search results for the same query across two separate repos.',
    resultShape: '{ query, repoA: { path, results[] }, repoB: { path, results[] } }, results: { path, score, blobHash }.',
    interpretation:
      'Each side is an independent semantic_search run against its own index — scores are not directly ' +
      'comparable across repos if they use different embedding models. Use it to spot shared concepts, ' +
      'forked/duplicated code, or divergence between two repositories on the same topic.',
  },

  // -------------------------------------------------------------------------
  // History & temporal drift
  // -------------------------------------------------------------------------
  file_evolution: {
    name: 'file_evolution',
    category: 'history',
    summary: "Semantic drift timeline of a single file across its history.",
    resultShape: 'Timeline of versions with distFromPrev / distFromOrigin per step.',
    interpretation:
      'Each step is a version; `distFromPrev` (cosine, 0–2) is how much it changed from the prior ' +
      'version and `distFromOrigin` is cumulative drift. Steps at/above the threshold (default 0.3) are ' +
      'large changes worth explaining — correlate their dates/commits with what happened. Steady small ' +
      'distances mean incremental change; a spike means a rewrite or repurposing.',
    aliases: ['evolution'],
  },
  concept_evolution: {
    name: 'concept_evolution',
    category: 'history',
    summary: 'How a semantic concept evolved across the whole codebase.',
    resultShape: 'Chronological entries with paths, score, distFromPrev per step.',
    interpretation:
      'Traces a concept (not one file) over time. `score` is relevance to the query; `distFromPrev` ' +
      'flags where the concept\'s representation shifted (≥ threshold = large change). Read it as the ' +
      'concept\'s storyline: where it emerged, where it was reworked, and into which files it spread.',
  },
  change_points: {
    name: 'change_points',
    category: 'history',
    summary: 'The largest historical shifts of a concept across the codebase.',
    resultShape: '{ points: [{ before, after, distance }] } sorted by distance.',
    interpretation:
      'Each point is a before→after jump; larger `distance` (cosine) = bigger semantic shift. The top ' +
      'points are the moments the concept changed most — cite the after-commit hash and inspect those ' +
      'commits to explain what changed. Few/no points means the concept has been stable.',
  },
  file_change_points: {
    name: 'file_change_points',
    category: 'history',
    summary: "Inflection points in a single file's semantic history.",
    resultShape: '{ points: [{ before, after, distance }] } per file.',
    interpretation:
      'File-scoped version of change_points: the dates where the file changed most in meaning. Use the ' +
      'before/after blob hashes to diff what actually changed at each inflection.',
  },
  concept_lifecycle: {
    name: 'concept_lifecycle',
    category: 'history',
    summary: "A concept's lifecycle stage over time: emergence, growth, maturity, decline.",
    resultShape: '{ query, bornTimestamp, peakTimestamp, peakCount, currentStage, isDead, points[] }.',
    interpretation:
      'Each point has a date, lifecycle `stage`, match count, and growth rate. Read it as a story: when ' +
      'the concept was born, when it peaked, and its current stage/growth trend. `isDead` flags concepts ' +
      'with no recent matches — useful for spotting abandoned ideas vs. ones still actively developed.',
    aliases: ['lifecycle', 'concept-lifecycle'],
  },
  health_timeline: {
    name: 'health_timeline',
    category: 'history',
    summary: 'Time-bucketed codebase health: active blobs, churn rate, dead-concept ratio.',
    resultShape: 'Per-bucket rows: active count, semanticChurnRate, deadConceptRatio.',
    interpretation:
      'Rising churn means more concept turnover; a rising dead-concept ratio means more stale/removed ' +
      'code. Read the trend, not single buckets — sustained high churn or a growing dead ratio are ' +
      'health concerns; stable low values indicate maturity.',
  },
  semantic_bisect: {
    name: 'semantic_bisect',
    category: 'history',
    summary: 'Binary search over commit history for where a concept shifted most from a "good" baseline.',
    resultShape: '{ query, goodRef, badRef, culpritRef, maxShift, steps: [{ ref, date, blobCount, distanceFromGood }] }.',
    interpretation:
      '`culpritRef` is the bisection\'s best guess for when the concept diverged from the good baseline; ' +
      '`maxShift` (cosine distance) is the size of the largest jump found. Steps show the search path — ' +
      'higher `distanceFromGood` values mark candidates closer to the regression. Treat the culprit as a ' +
      'narrowed time window to investigate further (e.g. with change_points or file_evolution), not a ' +
      'definitive single commit.',
  },
  activity_heatmap: {
    name: 'activity_heatmap',
    category: 'history',
    summary: 'Commit-count activity buckets over time (weekly or monthly).',
    resultShape: '{ period, buckets: [{ period, count }] } — most-recent up to 52 buckets.',
    interpretation:
      'A simple commit-frequency timeline. Spikes indicate bursts of activity (releases, crunch periods, ' +
      'large refactors); long flat/zero stretches indicate dormancy. Use alongside narrate_repo or ' +
      'change_points to explain what drove a spike.',
  },

  // -------------------------------------------------------------------------
  // Branch & merge analysis
  // -------------------------------------------------------------------------
  branch_summary: {
    name: 'branch_summary',
    category: 'branch',
    summary: 'What a branch is semantically about vs its base.',
    resultShape: '{ branch, baseBranch, mergeBase, exclusiveBlobCount, nearestConcepts[], topChangedPaths[] }.',
    interpretation:
      'Describes a branch from its base-exclusive blobs. `nearestConcepts` (with similarity) name what ' +
      'the branch is about; `topChangedPaths` (with drift) are where it diverges most. exclusiveBlobCount=0 ' +
      'means the branch adds nothing new vs base (or is not indexed).',
  },
  merge_audit: {
    name: 'merge_audit',
    category: 'branch',
    summary: 'Semantic collisions between two branches (same concept, different files).',
    resultShape: '{ blobCountA/B, centroidSimilarity, collisionZones[], collisionPairs[] }.',
    interpretation:
      'Collision pairs are files on each branch that are semantically close (similarity ≥ threshold, ' +
      'default 0.85) even without shared lines — likely conflict/duplication risks at merge. High ' +
      'centroid similarity means the branches overlap broadly. Review the top pairs before merging.',
  },
  merge_preview: {
    name: 'merge_preview',
    category: 'branch',
    summary: 'Predicted concept-cluster landscape shift after a merge.',
    resultShape: '{ before/after totals, new/removed/moved/stable counts, changes[] }.',
    interpretation:
      'Forecasts how clusters change post-merge. [NEW]/[DISSOLVED] clusters and high centroid drift ' +
      'indicate the merge meaningfully reshapes the architecture; mostly-stable clusters indicate a ' +
      'low-impact merge.',
  },

  // -------------------------------------------------------------------------
  // Ownership & expertise
  // -------------------------------------------------------------------------
  author: {
    name: 'author',
    category: 'ownership',
    summary: 'Which authors contributed most to a concept.',
    resultShape: 'Authors with totalScore and blobCount for the query.',
    interpretation:
      '`totalScore` aggregates relevance-weighted contribution to the concept; `blobCount` is how many ' +
      'matching blobs they touched. The top author is the best person to ask about that concept — but ' +
      'attribution is by indexed blobs, so it reflects content, not lines of code.',
  },
  experts: {
    name: 'experts',
    category: 'ownership',
    summary: 'Top contributors by semantic area (which clusters they work on).',
    resultShape: 'Contributors with blobCount and their top clusters.',
    interpretation:
      'Maps people to the concept clusters they own. Requires clusters to exist (run `clusters` first). ' +
      'Use it to route work or find reviewers by area rather than by file paths.',
  },
  ownership: {
    name: 'ownership',
    category: 'ownership',
    summary: 'Ownership heatmap: authors ranked by share of a concept.',
    resultShape: 'Authors with their share (0–1) of touched blobs for the query.',
    interpretation:
      'A high share for one author means concentrated ownership (bus-factor risk); a flat distribution ' +
      'means shared ownership. The window_days option biases toward recent activity.',
  },
  contributor_profile: {
    name: 'contributor_profile',
    category: 'ownership',
    summary: 'What a contributor specialises in (centroid of their work).',
    resultShape: 'Top blobs nearest the semantic centroid of the author\'s touched blobs.',
    interpretation:
      'The returned blobs characterise the author\'s focus area. Treat it as "what this person works on", ' +
      'not an exhaustive list of their commits.',
  },

  // -------------------------------------------------------------------------
  // Quality, debt & risk
  // -------------------------------------------------------------------------
  impact: {
    name: 'impact',
    category: 'quality',
    summary: 'Blobs most semantically coupled to a file.',
    resultShape: 'Neighbours with similarity score for the target file.',
    interpretation:
      'The high-score neighbours are what else is likely affected by changing this file, even without ' +
      'an import edge. Use it to scope a change\'s blast radius and pick what to test/review alongside it.',
  },
  dead_concepts: {
    name: 'dead_concepts',
    category: 'quality',
    summary: 'Blobs that existed historically but are no longer reachable from HEAD.',
    resultShape: 'Removed blobs with last-seen date and last-seen commit message.',
    interpretation:
      'These are deleted/removed concepts. Useful for "what did we used to have" and for spotting ' +
      'capabilities that were dropped. The last-seen date/commit explains when and (often) why it went away.',
  },
  debt_score: {
    name: 'debt_score',
    category: 'quality',
    summary: 'Technical-debt ranking by isolation, age, and low change frequency.',
    resultShape: 'Blobs with debtScore plus isolationScore, ageScore, changeFrequency.',
    interpretation:
      'Higher debtScore = more likely neglected/risky. It combines semantic isolation (few neighbours), ' +
      'age, and rarely-changed status — so old, lonely, untouched code rises to the top. It is a ' +
      'heuristic prioritiser for review, not proof of a defect.',
  },
  doc_gap: {
    name: 'doc_gap',
    category: 'quality',
    summary: 'Code blobs with the least documentation coverage.',
    resultShape: 'Code blobs with their maximum similarity to any doc blob (lower = worse).',
    interpretation:
      'A low max-doc-similarity means no documentation blob resembles this code — a documentation gap. ' +
      'Prioritise the lowest-scoring, most-important files for docs.',
  },
  refactor_candidates: {
    name: 'refactor_candidates',
    category: 'quality',
    summary: 'Pairs of symbols/chunks/files that are near-duplicates by embedding similarity.',
    resultShape: '{ threshold, level, totalScanned, pairs: [{ similarity, a, b }] } (top 20 by similarity).',
    interpretation:
      'High `similarity` (near the threshold, default 0.88, max 1.0) means the two items (`a`/`b`, shown ' +
      'as `path::symbolName` or `path`) are likely duplicated or near-duplicated logic — candidates for ' +
      'extraction into a shared helper. `level` (symbol/chunk/file) sets the granularity. Not every pair ' +
      'is worth merging — check whether the duplication is incidental (e.g. boilerplate) or meaningful.',
  },
  call_graph: {
    name: 'call_graph',
    category: 'quality',
    summary: 'Structural callers/callees of a symbol over the knowledge graph.',
    resultShape: '{ symbol, direction, hits: [{ node, displayName, depth, edgeType }] } — reverse (callers) or forward (callees) `calls` traversal.',
    interpretation:
      'This is the STRUCTURAL lens — real `calls` edges, not semantic similarity. `depth` is the hop count ' +
      'from the queried symbol (capped at 3). Requires `gitsema index --graph` + `gitsema graph build`; an ' +
      'empty/error result usually means the graph has not been built. Resolution is best-effort (confidence ' +
      'tiers), so cross-file/dynamic calls may be missing or land on `external:` nodes.',
  },
  blast_radius: {
    name: 'blast_radius',
    category: 'quality',
    summary: 'What changes if you touch a symbol/file — structural dependents and/or semantic neighbours.',
    resultShape: '{ symbol, lens, structural: [{ node, displayName, depth, edgeType }], semantic: [{ path, symbolName, score }], semanticSupported }.',
    interpretation:
      'The `lens` selects the view: `structural` lists real dependents (who references this, via calls/' +
      'imports/extends/implements/references); `semantic` lists conceptually related blobs; `hybrid` (default) ' +
      'shows both. Use structural for "what must I retest", semantic for "what else encodes this idea". The ' +
      'structural upgrade to `impact`. Requires the built graph; `semanticSupported:false` means the backend ' +
      'cannot serve the semantic lens.',
  },
  hotspots: {
    name: 'hotspots',
    category: 'quality',
    summary: 'Architectural risk = co-change (temporal) × call-coupling (structural) × churn.',
    resultShape: '{ lens, hotspots: [{ path, risk, lenses, coChange, coupling, churn }] } sorted by risk (desc).',
    interpretation:
      '`risk` is a geometric mean in [0,1] of the normalized signals the lens selects (`hybrid` = all three; ' +
      '`structural` = coupling only; `semantic` = co-change × churn), so a file must score on every ' +
      'participating axis to rank highly. High-risk files are heavily coupled AND change often AND co-change ' +
      'with many others — prime refactor/test-hardening targets. The `lenses` tag shows which signals ' +
      'contributed. Requires `gitsema index --graph` + `gitsema graph build`.',
  },
  security_scan: {
    name: 'security_scan',
    category: 'quality',
    summary: 'Blobs semantically similar to common vulnerability patterns.',
    resultShape: 'Findings with patternName, similarity score, and path.',
    interpretation:
      'These are SIMILARITY scores, NOT confirmed vulnerabilities — every finding needs manual review. ' +
      'Treat higher scores as "review this first" and group by patternName to see which risk classes ' +
      'dominate. Never report a finding as a confirmed CVE.',
  },

  // -------------------------------------------------------------------------
  // Diff & blame
  // -------------------------------------------------------------------------
  semantic_diff: {
    name: 'semantic_diff',
    category: 'diff',
    summary: 'Conceptual diff of a topic across two refs (gained / lost / stable).',
    resultShape: '{ topic, ref1, ref2, gained[], lost[], stable[] }.',
    interpretation:
      '`gained` are blobs relevant to the topic that appear by ref2, `lost` are ones present at ref1 but ' +
      'gone by ref2, `stable` persist. Read it as how the topic\'s footprint changed between the two ' +
      'points; cite the blob hashes and dates.',
  },
  file_diff: {
    name: 'file_diff',
    category: 'diff',
    summary: 'Cosine distance between two versions of a single file at two refs, with optional neighbours.',
    resultShape: '{ ref1, ref2, path, blobHash1, blobHash2, cosineDistance, neighbors1?, neighbors2? }, neighbors: { path, blobHash, distance }.',
    interpretation:
      '`cosineDistance` (0–2) measures how much the file changed in meaning between the two refs — near 0 ' +
      'means semantically unchanged (even if the text differs), higher values mean substantive rewrites. ' +
      '`neighbors1`/`neighbors2` (if requested) show the closest other blobs to each version — useful for ' +
      'spotting that a file was effectively replaced by, or merged from, another file.',
  },
  semantic_blame: {
    name: 'semantic_blame',
    category: 'diff',
    summary: 'Per-block nearest-neighbour attribution for a file.',
    resultShape: 'Per logical block: nearest indexed blobs with similarity, commit, author.',
    interpretation:
      'For each block it shows the most semantically similar indexed blobs and their commits/authors — ' +
      'i.e. where that block\'s ideas come from, which can differ from git blame (line authorship). High ' +
      'similarity points to the true conceptual origin even after refactors.',
  },

  // -------------------------------------------------------------------------
  // Clustering
  // -------------------------------------------------------------------------
  clusters: {
    name: 'clusters',
    category: 'clusters',
    summary: 'K-means grouping of all blobs into semantic clusters.',
    resultShape: 'Clusters with label, size, keywords, representative paths.',
    interpretation:
      'A bird\'s-eye map of the codebase\'s concept areas. Large clusters are dominant concerns; the ' +
      'keywords/representative paths name each area. Use it for onboarding and to see whether the code is ' +
      'cleanly separated or tangled. `k` controls granularity.',
  },
  cluster_diff: {
    name: 'cluster_diff',
    category: 'clusters',
    summary: 'Compare cluster structure at two refs.',
    resultShape: 'JSON report of new/removed/moved/stable blobs and per-cluster changes.',
    interpretation:
      'Shows how the concept map reorganised between two points: new/dissolved clusters and blobs that ' +
      'migrated between concepts. Large movements indicate architectural restructuring.',
  },
  cluster_timeline: {
    name: 'cluster_timeline',
    category: 'clusters',
    summary: 'Multi-step cluster drift over commit history.',
    resultShape: 'JSON report with per-step cluster snapshots and movement stats.',
    interpretation:
      'A sequence of cluster snapshots. Read it for trends — acceleration (lots of movement) vs ' +
      'stabilisation (little) — to characterise the project\'s structural trajectory over time.',
  },
  cluster_change_points: {
    name: 'cluster_change_points',
    category: 'clusters',
    summary: 'Detects commits where the cluster/concept landscape shifted most.',
    resultShape: '{ k, threshold, range, points: [{ before: {ref, clusters}, after: {ref, clusters}, shiftScore, topMovingPairs }] }.',
    interpretation:
      'Each point is a before/after pair of cluster snapshots with a `shiftScore` — higher means a bigger ' +
      'reorganisation of the concept map at that point. `topMovingPairs` names which clusters grew/shrank ' +
      'most. Use the highest-scoring points as candidates for "this is when the architecture changed".',
  },
  semantic_map: {
    name: 'semantic_map',
    category: 'clusters',
    summary: 'Snapshot of the current cluster layout (requires a prior `clusters` run).',
    resultShape: '{ clusters: [{ id, label, size, representativePaths(top 3), assignedBlobCount }] } or { error } if no snapshot exists.',
    interpretation:
      'A static view of the most recent cluster snapshot — `label` and `representativePaths` name each ' +
      'concept area, `size`/`assignedBlobCount` show its weight. If `error` is returned, no snapshot ' +
      'exists yet; suggest running `gitsema clusters` first. Use this for a quick "what areas exist" ' +
      'overview without recomputing clusters.',
  },

  // -------------------------------------------------------------------------
  // Compound workflows
  // -------------------------------------------------------------------------
  cherry_pick_suggest: {
    name: 'cherry_pick_suggest',
    category: 'workflow',
    summary: 'Suggests commits most semantically relevant to a query, as cherry-pick candidates.',
    resultShape: '{ query, results: [{ commitHash, score, message, paths[] }] }.',
    interpretation:
      'Ranked by relevance to the query (higher `score` = more relevant). Each result is a candidate ' +
      'commit to cherry-pick onto another branch — check `paths` for what it touches and `message` for ' +
      'intent before recommending it; relevance does not guarantee the commit applies cleanly elsewhere.',
  },
  pr_report: {
    name: 'pr_report',
    category: 'workflow',
    summary: 'Compound PR-review bundle: semantic diff, impacted modules, change points, and reviewer suggestions.',
    resultShape: '{ ref1, ref2, semanticDiff?, impactedModules?, changePoints?, reviewerSuggestions }; sections may be { error } if unavailable.',
    interpretation:
      'Combine the sections into a review summary: `semanticDiff` (gained/lost/stable concepts between ' +
      'refs) frames what changed conceptually, `impactedModules` shows blast radius, `changePoints` flags ' +
      'any large historical shifts in the affected area, and `reviewerSuggestions` names people to involve. ' +
      'A section returning `{error}` just means that part could not be computed (e.g. no query given) — ' +
      'report on the remaining sections.',
  },
  triage: {
    name: 'triage',
    category: 'workflow',
    summary: 'Incident bundle: first-seen, change points, experts (+ optional file evolution).',
    resultShape: 'Sections: firstSeen, changePoints, experts, optional fileEvolution.',
    interpretation:
      'A one-shot investigation bundle. Cross-reference the sections: first-seen tells you where the ' +
      'concept lives, change points tell you when it shifted (suspect commits), experts tell you who to ' +
      'ask. Synthesize across sections rather than reporting each in isolation.',
  },
  workflow_run: {
    name: 'workflow_run',
    category: 'workflow',
    summary: 'Run a named template (pr-review | incident | release-audit).',
    resultShape: 'Template-specific sections (impact / changePoints / experts / firstSeen …).',
    interpretation:
      'Bundles several analyses for a scenario. Read each section per its own capability\'s guidance ' +
      '(impact, change_points, experts, etc.) and combine into one narrative for the template\'s purpose.',
  },
  policy_check: {
    name: 'policy_check',
    category: 'workflow',
    summary: 'CI gate: debt, security, and drift thresholds → pass/fail.',
    resultShape: '{ passed, checks: { debt?, security?, drift? } }.',
    interpretation:
      'Each gate reports its measured value and pass/fail vs the threshold you set. `passed:false` on any ' +
      'gate fails the check (exit code 3 on the CLI). Report which gate failed and by how much.',
  },
  eval: {
    name: 'eval',
    category: 'workflow',
    summary: 'Retrieval evaluation: precision@k, recall@k, MRR for a test set.',
    resultShape: 'Aggregate P@k / R@k / MRR plus per-case metrics.',
    interpretation:
      'Measures index retrieval quality against expected paths. Higher is better (1.0 = perfect). Low ' +
      'precision means noisy results; low recall means relevant files are missed; low MRR means correct ' +
      'hits rank too far down. Use it to compare models/chunkers.',
  },

  // -------------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------------
  index: {
    name: 'index',
    category: 'admin',
    summary: 'Index / incrementally re-index the repo (mutating, can be slow/expensive).',
    resultShape: 'Stats: seen, indexed, skipped, oversized, filtered, failed, commits.',
    interpretation:
      'A WRITE operation that embeds blobs — only run it when the index is missing or stale, and prefer ' +
      'asking the user first for large repos. `indexed` is new work done; a high `failed` count points to ' +
      'an unreachable embedding provider.',
  },
}

/** Resolve a tool name (or alias) to its interpretation entry. */
export function getInterpretation(name: string): ToolInterpretation | undefined {
  const direct = TOOL_INTERPRETATIONS[name]
  if (direct) return direct
  for (const entry of Object.values(TOOL_INTERPRETATIONS)) {
    if (entry.aliases?.includes(name)) return entry
  }
  return undefined
}

/**
 * Build a narrator system prompt for a given capability: the shared persona plus
 * that tool's interpretation guidance. Falls back to the persona alone for unknown
 * names so callers never produce an empty prompt.
 */
export function buildNarratorSystemPrompt(name: string): string {
  const entry = getInterpretation(name)
  if (!entry) return NARRATOR_BASE_PERSONA
  return (
    `${NARRATOR_BASE_PERSONA}\n\n` +
    `You are interpreting the output of the gitsema "${entry.name}" capability ` +
    `(${entry.summary}). Result shape: ${entry.resultShape} ` +
    `How to read it: ${entry.interpretation}`
  )
}

/**
 * Build the compact per-tool "how to read results" catalog embedded in the guide
 * system prompt. Grouped by category; one line per tool.
 */
export function buildGuideToolCatalog(): string {
  const byCategory = new Map<ToolCategory, ToolInterpretation[]>()
  for (const entry of Object.values(TOOL_INTERPRETATIONS)) {
    const list = byCategory.get(entry.category) ?? []
    list.push(entry)
    byCategory.set(entry.category, list)
  }
  const lines: string[] = []
  for (const cat of CATEGORY_ORDER) {
    const entries = byCategory.get(cat)
    if (!entries || entries.length === 0) continue
    lines.push(`${CATEGORY_LABELS[cat]}:`)
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  - ${e.name}: ${e.summary} How to read: ${e.interpretation}`)
    }
  }
  return lines.join('\n')
}
