# Productized Usage Patterns

`gitsema` ships 8 productized workflow patterns covering the core developer
lifecycle: code production, review, and discovery. Each pattern is a
composable pipeline of existing gitsema primitives surfaced through the
`gitsema workflow run <pattern>` command.

---

## Quick reference

```
gitsema workflow list          # show all 8 patterns with one-line descriptions
gitsema workflow run <pattern> [options]
```

---

## Pattern 1 — PR Semantic Risk Gate

**Goal:** Assess semantic risk before merging a pull request.

Combines cross-module impact analysis, concept change-point detection, and
expert identification to answer: *What does this change touch semantically?
Who should review it? Has this area shifted dangerously recently?*

```bash
gitsema workflow run pr-review --file src/auth/middleware.ts --query "authentication"
```

**Output sections:**

| Section | Source |
|---|---|
| `impact` | `computeImpact()` — cross-module coupling for the changed file |
| `changePoints` | `computeConceptChangePoints()` — recent semantic inflection points |
| `experts` | `computeExperts()` — top authors by semantic ownership |

**Required flags:** `--file <path>` — the file being reviewed.

**Optional flags:** `--query <text>` (concept override), `-k <n>` (result limit).

---

## Pattern 2 — Release Narrative Pack

**Goal:** Generate a semantic summary of changes in a release window.

Surfaces the top-changed concepts, concept change-point timeline, and expert
owners to support release notes, changelog automation, and sign-off workflows.

```bash
gitsema workflow run release-audit --query "payment billing checkout" -k 10
```

**Output sections:**

| Section | Source |
|---|---|
| `topChangedConcepts` | `vectorSearch()` — most-relevant blobs for the query |
| `changePoints` | `computeConceptChangePoints()` — timeline of concept shifts |
| `experts` | `computeExperts()` — who knows this area best |

**Optional flags:** `--query <text>` (default: `"architecture changes quality"`),
`-k <n>`.

---

## Pattern 3 — Onboarding Assistant

**Goal:** Give a new team member a role-focused semantic tour of the codebase.

Maps a role or domain topic (e.g. `auth`, `billing`, `frontend`) to the most
relevant blobs in history, shows how the concept evolved, and identifies who
to ask.

```bash
gitsema workflow run onboarding --role auth
gitsema workflow run onboarding --role "payment processing" -k 8
```

**Output sections:**

| Section | Source |
|---|---|
| `relevantBlobs` | `vectorSearch()` — top blobs matching the role/topic |
| `changePoints` | `computeConceptChangePoints()` — concept evolution timeline |
| `keyExperts` | `computeExperts()` — people to talk to |

**Optional flags:** `--role <topic>` or `--query <topic>` (default: `"authentication"`),
`-k <n>`.

---

## Pattern 4 — Incident Triage Console

**Goal:** Rapidly root-cause an incident using semantic search over Git history.

Finds where a concept first appeared, identifies historical change-points
(moments of rapid semantic shift), and surfaces the experts with context.

```bash
gitsema workflow run incident --query "token expiry validation failure"
```

**Output sections:**

| Section | Source |
|---|---|
| `firstSeen` | `vectorSearch()` — earliest relevant blobs for the query |
| `changePoints` | `computeConceptChangePoints()` — inflection points |
| `experts` | `computeExperts()` — who knows this concept |

**Required flags:** `--query <text>` — the incident concept or error message.

**Optional flags:** `-k <n>`.

---

## Pattern 5 — Ownership Intelligence

**Goal:** Auto-suggest reviewers and owners using semantic author attribution.

Embeds the query concept, finds matching blobs, and ranks contributors by
semantic ownership score — providing a principled way to suggest PR reviewers
or documentation owners.

```bash
gitsema workflow run ownership-intel --query "rate limiting middleware"
```

**Output sections:**

| Section | Source |
|---|---|
| `suggestedReviewers` | `computeAuthorContributions()` — ranked by semantic score |
| `topResults` | `vectorSearch()` — matching blobs for context |

**Required flags:** `--query <text>` — the concept to attribute.

**Optional flags:** `-k <n>`.

---

## Pattern 6 — Architecture Drift Monitor

**Goal:** Track structural health and technical debt over time.

Runs a health timeline (blob activity by time bucket) and a debt score
(isolation × age × change-frequency) along with concept change-points for
the architecture topic. Use periodically (e.g. weekly CI job) to detect drift.

```bash
gitsema workflow run arch-drift -k 12
gitsema workflow run arch-drift --query "dependency injection modules" -k 8
```

**Output sections:**

| Section | Source |
|---|---|
| `health` | `computeHealthTimeline()` — blob activity over time |
| `debt` | `scoreDebt()` — debt scores by module |
| `changePoints` | `computeConceptChangePoints()` — architecture concept shifts |

**Optional flags:** `--query <text>` (default: `"architecture structure modules"`),
`-k <n>` (controls both health buckets and debt top-N).

---

## Pattern 7 — Knowledge Discovery Portal

**Goal:** Broad semantic discovery for platform teams or cross-cutting concepts.

Optimized for open-ended exploration: surfaces matching blobs from across the
full repository history, identifies related concept trajectories, and names
owners — useful for multi-team or multi-repo knowledge-sharing.

```bash
gitsema workflow run knowledge-portal --query "feature flags rollout"
```

**Output sections:**

| Section | Source |
|---|---|
| `results` | `vectorSearch()` — top matching blobs |
| `relatedConcepts` | `computeConceptChangePoints()` — concept drift trajectory |
| `owners` | `computeExperts()` — knowledge owners |

**Required flags:** `--query <text>` — the concept to explore.

**Optional flags:** `-k <n>`.

---

## Pattern 8 — Regression Forecasting

**Goal:** Predict semantic regression risk before or after a refactor.

Computes the current semantic neighbourhood of a concept, shows historical
change-points as a risk signal, and identifies the owners who should validate
the change. Pair with `gitsema diff <ref> HEAD <query>` for a full before/after
comparison.

```bash
gitsema workflow run regression-forecast --query "auth session handling" --ref main~20
```

**Output sections:**

| Section | Source |
|---|---|
| `currentNeighbourhood` | `vectorSearch()` — current nearest semantic neighbours |
| `changePoints` | `computeConceptChangePoints()` — historical risk signal |
| `riskOwners` | `computeExperts()` — who to loop in |
| `baseRef` | *(informational)* — the ref provided with `--ref` |
| `note` | *(informational)* — pointer to `gitsema diff` for full comparison |

**Required flags:** `--query <text>` — the concept being refactored.

**Optional flags:** `--ref <git-ref>` (base ref for comparison context), `-k <n>`.

---

## Output formats

All patterns accept the standard `--out` flag:

```bash
# JSON to stdout
gitsema workflow run pr-review --file src/auth.ts --out json

# JSON to file + Markdown to stdout
gitsema workflow run release-audit --out json:release.json --out markdown

# Legacy (still supported)
gitsema workflow run incident --query "timeout" --dump out.json
```

---

## CI integration example

```yaml
# .github/workflows/pr-risk-gate.yml
name: PR Semantic Risk Gate
on: [pull_request]
jobs:
  semantic-risk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Run semantic risk gate
        env:
          GITSEMA_PROVIDER: http
          GITSEMA_HTTP_URL: ${{ secrets.GITSEMA_HTTP_URL }}
          GITSEMA_API_KEY:  ${{ secrets.GITSEMA_API_KEY }}
        run: |
          gitsema workflow run pr-review \
            --file "${{ github.event.pull_request.head.sha }}" \
            --out json:pr-risk.json
      - uses: actions/upload-artifact@v4
        with:
          name: pr-risk-report
          path: pr-risk.json
```
