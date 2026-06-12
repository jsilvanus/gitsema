# Plan 3 — Next Steps (from docs/review2.md Part 3)

### Cross-Cutting Observations

**Fix existing gaps before building new features:**
1. Missing MCP tools — 8 commands lack MCP equivalents.
2. Missing `--model` flags — 4 commands embed queries without model selection.
3. Missing `--branch` flags — 4 analysis commands lack branch scoping.
4. Missing HTTP routes — 6 analysis commands lack API equivalents.
5. Missing `--html` on 4 search/analysis commands that would benefit.

**Architectural recommendations:**
1. **`SearchPipeline` abstraction** — composable features (boolean queries → expansion → explanation → saved queries) without duplicating scoring logic.
2. **`concept_snapshot` table** — cache per-commit concept centroids. Enables semantic bisect, lifecycle analysis, and health timeline without recomputing.
3. **`FeatureFlags` system** — config-based toggles for gradually rollable features.

### Recommended Implementation Order

```
Phase 37: Quick Wins (1-2 days each)
  - Code-to-Code Search (Low complexity, High value)
  - Negative Examples Search (Low complexity, High value)
  - Partial/Selective Indexing (Low complexity, High value)
  - Result Explanation (Low-Med complexity, High value)

Phase 38: Medium Effort, High Impact (3-5 days each)
  - Semantic Git Bisect
  - Garbage Collection
  - Boolean/Composite Queries
  - Documentation Gap Analysis

Phase 39: Analysis Features (1-2 weeks each)
  - Refactoring Suggestions
  - Concept Lifecycle Analysis
  - Contributor Semantic Profiles
  - CI/CD Semantic Diff in PRs

Phase 40: Visualization & Scale (2-4 weeks each)
  - Semantic Codebase Map (UMAP/t-SNE)
  - Temporal Heatmap
  - Remote Index Sharing
  - Semantic Cherry-Pick Suggestions

Phase 41+: Large Investments (4+ weeks each)
  - Multi-Repo Unified Index
  - IDE / LSP Integration
  - Security Pattern Detection
  - Codebase Health Timeline
  - Technical Debt Scoring
```
