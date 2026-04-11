# gitsema Role-Based Quickstart Playbooks

Quickstart recipes for four common user roles. Each playbook gives you a minimal working workflow — run these after your initial index is complete.

---

## Prerequisites (all roles)

```bash
# Index your repo first (HEAD-first by default)
gitsema index start

# Verify coverage
gitsema index
```

---

## Solo Developer

**Goal:** reduce "where is this?" friction and understand how your codebase evolved.

```bash
# 1. Find code related to a topic
gitsema search "rate limiting logic"

# 2. Find where a concept first appeared
gitsema first-seen "JWT authentication"

# 3. Track semantic drift in a specific file
gitsema file-evolution src/auth/middleware.ts

# 4. Detect when major changes happened
gitsema change-points "authentication"

# 5. Understand dead / removed concepts
gitsema dead-concepts

# 6. Get a cluster map of your codebase
gitsema clusters

# 7. Narrate any output with an LLM
export GITSEMA_LLM_URL=http://localhost:11434
gitsema evolution "database layer" --narrate

# Alias tip: add to your shell profile
alias gs='gitsema search'
alias gfe='gitsema file-evolution'
```

**Recommended index settings for solo use:**

```bash
gitsema index start --chunker function --concurrency 2
```

---

## PR Reviewer

**Goal:** quickly understand the semantic impact of a PR before approving.

```bash
# Replace <base> and <head> with the relevant refs / commit SHAs

# 1. Semantic summary of what changed in this branch vs base
gitsema branch-summary --branch <feature-branch>

# 2. Detect if the change collides with related work in other modules
gitsema merge-audit <base> <head>

# 3. Preview the semantic impact before merge
gitsema merge-preview <base> <head>

# 4. Find security-pattern matches in changed files
gitsema security-scan --branch <feature-branch>

# 5. Spot refactor candidates introduced by this change
gitsema refactor-candidates --branch <feature-branch>

# 6. Identify concepts whose semantic distance jumped sharply
gitsema file-change-points <path/to/changed/file>

# Combined review pipeline (pipe-friendly)
gitsema branch-summary --branch <feature-branch> --out json | \
  gitsema security-scan --branch <feature-branch> --out json
```

**MCP integration:** add `gitsema tools mcp` to your editor's MCP server list and ask your AI assistant: *"What does this PR change semantically?"*

---

## Security Engineer

**Goal:** scan for vulnerability patterns, audit code semantics, and monitor security-relevant concepts.

```bash
# 1. Run the semantic security scan (pattern similarity, not confirmed CVEs)
gitsema security-scan

# 2. Find where secrets / credential patterns appear
gitsema search "api key secret credential" --top 20

# 3. Track how authentication logic evolved
gitsema evolution "authentication" --dump auth-evolution.json

# 4. Detect when security-relevant changes were introduced
gitsema change-points "SQL injection" --top 5
gitsema change-points "input validation"

# 5. Find who "owns" security-sensitive concepts
gitsema author "authentication middleware"
gitsema author "input sanitization"

# 6. Check for stale security code
gitsema dead-concepts | grep -i auth

# 7. Export SARIF for CI integration
gitsema security-scan --out sarif:security.sarif

# Automated gate: fail if high-confidence findings > threshold
# (combine with CI pipeline, see docs/deploy.md)
```

**Key env vars for security scanning:**

```bash
# Increase recall for pattern matching
export GITSEMA_SYMBOL_CAP=50000
export GITSEMA_CHUNK_CAP=50000
gitsema security-scan
```

---

## Release Manager

**Goal:** generate a semantic narrative of what changed in this release and identify risk.

```bash
# Replace <prev-tag> and <new-tag> with your release tags

# 1. Cluster diff: what semantic areas changed between releases
gitsema cluster-diff <prev-tag> <new-tag>

# 2. Concept evolution summary for release notes
gitsema evolution "core feature area" --dump evolution-report.json

# 3. Health timeline: how health metrics trended
gitsema health --since <prev-tag>

# 4. Debt snapshot: identify areas that accumulated debt
gitsema debt --top 20

# 5. Cluster timeline for multi-step drift analysis
gitsema cluster-timeline <tag1> <tag2> <new-tag>

# 6. Narrate the release with an LLM summary
export GITSEMA_LLM_URL=https://api.openai.com
export GITSEMA_LLM_MODEL=gpt-4o-mini
export GITSEMA_API_KEY=sk-...
gitsema cluster-diff <prev-tag> <new-tag> --narrate

# 7. Find contributor-level attribution for new concepts
gitsema contributor-profile --since <prev-tag>

# Generate full release bundle (JSON + narration)
gitsema cluster-diff <prev-tag> <new-tag> --out json:release-clusters.json --narrate
gitsema health --out json:release-health.json
gitsema evolution "key concept" --out json:release-evolution.json --narrate
```

**Scheduling:** add to your release pipeline to auto-generate semantic release notes:

```yaml
# .github/workflows/release-semantics.yml
- name: Semantic release notes
  run: |
    gitsema index start
    gitsema cluster-diff ${{ github.event.release.target_commitish }}~1 ${{ github.sha }} \
      --narrate --out json:semantic-notes.json
```

---

## Further reading

- [Full command reference →](../README.md#commands)
- [Team operations guide →](deploy.md#team-operations)
- [MCP / AI integration →](../README.md#mcp-integration)
- [Feature catalog →](features.md)
