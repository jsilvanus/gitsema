# Explainer Module — Contract from gitsema

> This document describes what gitsema needs from the Explainer module.  
> The Explainer is a JS library imported into gitsema and called as functions — not an HTTP service.

---

## Overview

gitsema is a semantic Git index. It produces structured analysis data (timelines, clusters, diffs, security findings, etc.) and currently calls an OpenAI-compatible `/v1/chat/completions` endpoint to generate short human-readable summaries via `--narrate`.

**The problem:** gitsema builds ad-hoc text prompts, sends them to a remote LLM, and gets back free-form unstructured text. There's no determinism, no citations, no structured output, and prompt logic is tangled into gitsema's codebase.

**The solution:** Replace all of that with calls to the Explainer library. gitsema passes structured evidence + a task descriptor. The Explainer owns the prompt templates, calls the LLM with deterministic settings, and returns structured JSON with citations.

---

## How gitsema will use the Explainer

```js
import { Explainer } from 'embedeer'  // or however the package exports it

// Create once, reuse across calls
const explainer = Explainer.create('llama-3.2-3b', {
  deterministic: true,  // greedy decode, temp=0
})

// Call it with structured evidence
const result = await explainer.explain({
  task: 'narrate',
  domain: 'evolution',
  context: { filePath: 'src/auth/handler.ts', threshold: 0.3 },
  evidence: [
    { id: 1, source: 'src/auth/handler.ts', excerpt: '2024-03-15  dist_prev=0.421  dist_origin=0.312  *** LARGE CHANGE' },
    { id: 2, source: 'src/auth/handler.ts', excerpt: '2024-06-01  dist_prev=0.089  dist_origin=0.398' },
    // ...
  ],
  maxTokens: 256,
})

// result.explanation  — "The auth handler underwent a major rewrite on 2024-03-15 [1]..."
// result.labels       — [] (empty for narrate tasks)
// result.references   — [{ id: 1, source: "src/auth/handler.ts", claim: "major rewrite" }]
```

---

## Function interface

### `Explainer.create(modelName, opts)`

Factory. Returns an `Explainer` instance bound to a model.

```ts
interface ExplainerOpts {
  deterministic?: boolean   // default: true — greedy, temp=0, top_k=1, seeded
  // any other model-loading / backend config the Explainer needs
}

Explainer.create(modelName: string, opts?: ExplainerOpts): Explainer
```

gitsema won't care which backend loads the model — that's the Explainer's internal concern. It just needs to pass a model name and get a callable.

### `explainer.explain(request)`

The single function gitsema calls. Every narration, labeling, and explanation task goes through this.

```ts
interface ExplainRequest {
  /** What kind of output gitsema wants. */
  task: 'narrate' | 'label' | 'explain'

  /** Selects the prompt template variant on the Explainer side. */
  domain: string

  /** Free-form context about the analysis (file path, query, ref range, etc.) */
  context: Record<string, unknown>

  /** Numbered evidence blocks. The Explainer injects these into the prompt. */
  evidence: EvidenceBlock[]

  /** Max output tokens. Default: 256. */
  maxTokens?: number

  /** For "label" tasks: max labels to generate. Default: 4. */
  maxLabels?: number
}

interface EvidenceBlock {
  /** Sequential ID (1-based). The LLM cites these. */
  id: number
  /** Origin — file path, cluster name, or other source identifier. */
  source: string
  /** Pre-formatted data snippet. Short, one line preferred. */
  excerpt: string
  /** Optional structured metadata (gitsema may include scores, dates, etc.) */
  metadata?: Record<string, unknown>
}
```

### Return type

```ts
interface ExplainResult {
  /** Human-readable summary. "INSUFFICIENT_EVIDENCE" if the model can't answer. */
  explanation: string

  /** Structured labels (populated for "label" tasks; may be empty for "narrate"). */
  labels: Label[]

  /** Citations — each maps back to an evidence block ID. */
  references: Reference[]

  /** Generation metadata. */
  meta: {
    model: string
    tokensUsed: number
    deterministic: boolean
  }
}

interface Label {
  name: string
  rationale: string
  confidence?: number  // 0–1
}

interface Reference {
  id: number           // matches EvidenceBlock.id
  source: string       // echoed from evidence
  claim?: string       // what claim this evidence supports
}
```

---

## The 13 domains gitsema will call

Each domain maps to a prompt template the Explainer owns. gitsema sends the structured data; the Explainer formats the prompt.

### Task: `narrate` (11 domains)

These all return `explanation` + `references`. Labels are empty.

#### 1. `domain: "evolution"`

Summarize the semantic drift timeline of a single file.

```ts
context: { filePath: string, threshold: number }
evidence: [
  // One block per file version (max ~20)
  { id: 1, source: "src/foo.ts", excerpt: "2024-03-15  dist_prev=0.421  dist_origin=0.312  *** LARGE CHANGE" },
  { id: 2, source: "src/foo.ts", excerpt: "2024-06-01  dist_prev=0.089  dist_origin=0.398" },
]
// metadata per block:
//   timestamp: number (unix), distFromPrev: number, distFromOrigin: number, isLargeChange: boolean
```

Expected output: 2–4 sentences about when significant changes occurred and what the drift pattern indicates.

#### 2. `domain: "clusters"`

Summarize the overall codebase structure from a k-means clustering result.

```ts
context: { totalBlobs: number, clusterCount: number }
evidence: [
  // One block per cluster
  { id: 1, source: "src/core/", excerpt: 'Cluster 1 (342 blobs): label="auth middleware" keywords=[jwt, session, oauth] paths=[src/auth/handler.ts, src/auth/oauth.ts]' },
  { id: 2, source: "src/cli/",  excerpt: 'Cluster 2 (128 blobs): label="CLI commands" keywords=[commander, option, parse] paths=[src/cli/index.ts]' },
]
// metadata per block:
//   size: number, label: string, topKeywords: string[], representativePaths: string[]
```

Expected output: 2–4 sentences about architectural organization, main concerns, any suspicious clustering.

#### 3. `domain: "security"`

Triage summary of semantic security scan findings.

```ts
context: { totalFindings: number, highCount: number, mediumCount: number }
evidence: [
  // One block per finding (max ~12)
  { id: 1, source: "src/auth/handler.ts", excerpt: '[hardcoded-secret] confidence=high score=0.912 heuristic="const API_KEY = ..."' },
  { id: 2, source: "src/db/query.ts",     excerpt: '[sql-injection] confidence=medium score=0.734' },
]
// metadata per block:
//   patternName: string, confidence: "high"|"medium"|"low", score: number, heuristicMatches?: string[]
```

Expected output: 2–4 sentences prioritizing critical findings and areas of risk.

#### 4. `domain: "search"`

Summarize semantic search results for a query.

```ts
context: { query: string, resultCount: number }
evidence: [
  // One block per search result (max ~15)
  { id: 1, source: "src/auth/handler.ts", excerpt: "score=0.912" },
  { id: 2, source: "src/auth/oauth.ts",   excerpt: "score=0.847" },
]
// metadata per block:
//   score: number, blobHash: string
```

Expected output: 2–3 sentences about which areas of the codebase match and what patterns stand out.

#### 5. `domain: "cluster-diff"`

How codebase architecture shifted between two Git refs.

```ts
context: { ref1: string, ref2: string, newBlobsTotal: number, removedBlobsTotal: number, movedBlobsTotal: number, stableBlobsTotal: number }
evidence: [
  // One block per active cluster change (max ~6)
  { id: 1, source: "auth middleware", excerpt: '"+12 new, -3 removed, 5 migrated-in, 2 migrated-out"' },
]
// metadata per block:
//   label: string, newBlobs: number, removedBlobs: number, inflowCount: number, outflowCount: number
```

Expected output: 2–4 sentences about significant architectural movements.

#### 6. `domain: "cluster-timeline"`

Multi-step cluster evolution over several checkpoints.

```ts
context: { stepCount: number, k: number }
evidence: [
  // One block per timeline step
  { id: 1, source: "v1.0",  excerpt: 'Step 1 [v1.0] 1200 blobs (baseline) — top clusters: "auth", "db", "cli"' },
  { id: 2, source: "v1.5",  excerpt: 'Step 2 [v1.5] 1450 blobs (+80 new, -12 removed, 34 moved) — top clusters: "auth", "api", "cli"' },
]
// metadata per block:
//   ref: string, blobCount: number, newBlobs?: number, removedBlobs?: number, movedBlobs?: number, topLabels: string[]
```

Expected output: 2–4 sentences about dominant trends, acceleration/stabilization periods.

#### 7. `domain: "change-points"`

When a semantic concept changed most significantly across the codebase.

```ts
context: { query: string, pointCount: number }
evidence: [
  // One block per change point (max ~8, sorted by distance descending)
  { id: 1, source: "src/auth/handler.ts → src/auth/v2.ts", excerpt: '2024-01-10 → 2024-03-15  distance=0.5821  before=[src/auth/handler.ts]  after=[src/auth/v2.ts]' },
]
// metadata per block:
//   distance: number, beforeDate: string, afterDate: string, beforePaths: string[], afterPaths: string[]
```

Expected output: 2–3 sentences about when and how the concept shifted.

#### 8. `domain: "file-change-points"`

Same as change-points but scoped to a single file.

```ts
context: { filePath: string, pointCount: number }
evidence: [
  // One block per change point
  { id: 1, source: "src/auth/handler.ts", excerpt: '2024-01-10 → 2024-03-15  distance=0.5821  before=[a1b2c3d]  after=[e4f5g6h]' },
]
// metadata per block:
//   distance: number, beforeDate: string, afterDate: string, beforeCommit: string, afterCommit: string
```

Expected output: 2–3 sentences about key inflection points in the file's history.

#### 9. `domain: "diff"`

Interpret cosine distance between two versions of a file.

```ts
context: { filePath: string, ref1: string, ref2: string, cosineDistance: number, interpretation: string }
// interpretation is one of: "virtually identical", "minor drift", "moderate change", "significant rewrite", "complete semantic overhaul"
evidence: [
  { id: 1, source: "neighbors@ref1", excerpt: "src/auth/handler.ts, src/auth/session.ts, src/middleware/cors.ts" },
  { id: 2, source: "neighbors@ref2", excerpt: "src/api/routes.ts, src/auth/v2.ts, src/middleware/jwt.ts" },
]
// metadata per block:
//   ref: string, neighborPaths: string[]
```

Expected output: 2–3 sentences interpreting the distance and neighbor shift.

#### 10. `domain: "health"`

Codebase health trajectory over time.

```ts
context: { periodCount: number }
evidence: [
  // One block per health snapshot period (max ~16)
  { id: 1, source: "2024-01–2024-03", excerpt: "active=1200  churn=0.045  dead=0.082" },
  { id: 2, source: "2024-04–2024-06", excerpt: "active=1450  churn=0.112  dead=0.095" },
]
// metadata per block:
//   periodStart: number, periodEnd: number, activeBlobCount: number, semanticChurnRate: number, deadConceptRatio: number
```

Expected output: 2–4 sentences about health trajectory, churn spikes, stability trends.

#### 11. `domain: "lifecycle"`

Lifecycle story of a semantic concept.

```ts
context: { query: string, bornDate: string, peakDate: string, peakCount: number, currentStage: string, isDead: boolean }
evidence: [
  // One block per lifecycle data point (max ~12)
  { id: 1, source: "2023-06-01", excerpt: "stage=emerging  matches=3  growth=0.450" },
  { id: 2, source: "2024-01-15", excerpt: "stage=growing  matches=18  growth=0.220" },
]
// metadata per block:
//   date: string, stage: string, matchCount: number, growthRate: number
```

Expected output: 2–4 sentences about emergence, growth pattern, current stage, long-term importance.

---

### Task: `label` (1 domain)

Returns `labels` array as the primary output. `explanation` is a one-line summary. `references` cite the evidence used.

#### 12. `domain: "cluster-label"`

Generate a descriptive label for a semantic cluster of code.

```ts
context: { clusterIndex: number, size: number }
evidence: [
  // Representative file excerpts and paths from the cluster
  { id: 1, source: "src/auth/handler.ts",  excerpt: "export function validateJwt(token: string)..." },
  { id: 2, source: "src/auth/oauth.ts",    excerpt: "async function exchangeOAuthCode(code)..." },
  { id: 3, source: "src/auth/session.ts",  excerpt: "class SessionManager { constructor(store)..." },
]
// metadata per block:
//   blobHash: string, topKeywords: string[]
maxLabels: 1  // one label per cluster
```

Expected output:
- `labels[0].name`: short label like `"Authentication & Session Management"`
- `labels[0].rationale`: why this label fits based on the evidence
- `labels[0].confidence`: how well the evidence supports the label

---

### Task: `explain` (1 domain)

Returns `explanation` with dense citations + `references`. This is for `--explain-llm` on search results.

#### 13. `domain: "search-explain"`

Explain why search results match a query, with per-result attribution.

```ts
context: { query: string }
evidence: [
  // Provenance citation blocks (from gitsema's explainFormatter)
  { id: 1, source: "src/auth/handler.ts", excerpt: "score=0.847 blob=a1b2c3d firstSeen=2024-03-15 cosine=0.921 recency=0.712 snippet='export function validateJwt...'" },
  { id: 2, source: "src/auth/oauth.ts",   excerpt: "score=0.812 blob=e4f5g6h firstSeen=2024-06-01 cosine=0.889 recency=0.634 snippet='async function exchangeOAuth...'" },
]
// metadata per block:
//   score: number, blobHash: string, firstSeen: string, signals: { cosine, recency, pathScore, bm25 }, snippet: string
```

Expected output: paragraph explaining which results are most relevant and why, citing each result by ID.

---

## Constraints the Explainer must enforce

| Constraint | Detail |
|-----------|--------|
| **Deterministic** | Greedy decode, `temperature=0`, `top_k=1`, `do_sample=false`, fixed seed. Identical inputs → identical outputs. |
| **JSON-only output** | The Explainer returns a parsed `ExplainResult` object. JSON parsing + repair is internal. gitsema never sees raw model text. |
| **Citation-backed** | Every claim in `explanation` must cite evidence by `[id]`. The model must not invent IDs. |
| **Evidence-bounded** | The model may only reference provided evidence. No external knowledge claims. |
| **Token-capped** | `maxTokens` defaults to 256, gitsema may pass up to 512. Keep output concise. |
| **Graceful failure** | If evidence is insufficient, return `explanation: "INSUFFICIENT_EVIDENCE"` with empty labels/references. Never throw for model-level failures — return a structured error. |
| **Sync function feel** | Returns a `Promise<ExplainResult>`. No streaming, no callbacks, no events. Single-turn. |

---

## What gitsema does NOT send

- **Raw prompts.** gitsema never constructs prompt text. The Explainer owns prompt templates.
- **Model config.** gitsema doesn't specify temperature, top_p, beam parameters. The Explainer manages all decode settings.
- **Full file contents.** Evidence excerpts are short (max ~500 chars each). gitsema pre-trims.
- **Embedding vectors.** This is a text generation interface, not a vector interface.

---

## Error handling contract

```ts
// The Explainer should never throw for LLM-level issues.
// Instead, return a structured result with explanation indicating the problem.

// For infrastructure errors (model not loaded, OOM), throw with a descriptive Error.
// gitsema will catch and display: "(LLM narration failed: <message>)"

try {
  const result = await explainer.explain(request)
  if (result.explanation === 'INSUFFICIENT_EVIDENCE') {
    // gitsema skips narration output
  } else {
    console.log(result.explanation)
  }
} catch (e) {
  console.log(`(LLM narration failed: ${e.message})`)
}
```

---

## Summary of what to build

1. **`Explainer.create(modelName, opts)`** — factory, loads/connects to model once
2. **`explainer.explain(request)`** — single function, handles all 13 domains
3. **13 prompt templates** — one per domain, stored internally in the Explainer
4. **JSON output parsing + repair** — internal, gitsema never sees raw text
5. **Deterministic generation defaults** — greedy, seeded, no sampling
6. **Evidence injection** — takes the `evidence[]` array and formats it as numbered blocks in the prompt
7. **Citation extraction** — parses `[1]`, `[2]` references from model output and maps to evidence IDs

gitsema will `import { Explainer } from 'embedeer'` and call it as shown above. No HTTP, no CLI subprocess, just a function call.
