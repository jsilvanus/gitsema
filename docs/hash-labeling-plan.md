# Hash Labeling & Disambiguation Plan

**Targets:** Phase 153

## Problem Statement

Users encounter unlabeled hashes throughout gitsema output (CLI, MCP, HTTP, HTML) and naturally interpret them as **commit hashes** (the Git-level identifier they understand). In reality, these are **blob hashes** (content-addressed, internal implementation detail). This ambiguity causes confusion, especially when LLMs/Claude read the tool output and misidentify which hash type is which.

### Example
```
0.898  src/auth/login.ts  [abc1234]
```

A user sees `[abc1234]` and thinks: "This must be a commit hash." It's actually a blob hash.

## Root Cause

`src/core/search/ranking.ts:53` defines `renderResults()`, which outputs:
```typescript
let line = `${score}  ${path}  [${shortHash(r.blobHash)}]`
```

This function is used by:
- CLI: `gitsema search`, `gitsema first-seen`, `gitsema code-search`
- MCP: `semantic_search`, `search_history`, `code_search`
- HTTP: `/search`, `/first-seen` (text rendering mode)

The unlabeled hash ripples across all these interfaces.

## Solution Overview

### Scope 1: Core Output Formatters (Highest Impact)
- Update `renderResults()` to prefix blob hashes with `blob:`
- Update `renderResultsByLevel()` (delegates to `renderResults()`, so fix cascades)
- Update all HTML renderers to use explicit type labels

### Scope 2: Documentation & Clarity (Zero Code Impact)
- Update OpenAPI spec field descriptions to clarify blob vs commit hash
- Update MCP tool interpretations to guide LLMs
- Update skill documentation

### Scope 3: Consistency Audit & Future-Proofing
- Add unit tests for hash labeling
- Verify all interfaces (CLI, MCP, HTTP, HTML, LSP)
- Document hash-type conventions for future code

## Changes by Area

### Area 1: `src/core/search/ranking.ts`

**Function: `renderResults()`** (line 53)

Current:
```typescript
const hash = shortHash(r.blobHash)
let line = `${score}  ${path}  [${hash}]`
```

Proposed:
```typescript
const hash = shortHash(r.blobHash)
let line = `${score}  ${path}  [blob:${hash}]`
```

**Why:** Single change fixes CLI, MCP, HTTP text output.

**Function: `renderResultsByLevel()`** (line 85)

Current implementation delegates to `renderResults()`, so no change needed here — fix cascades automatically.

**Function: `renderFirstSeenResults()`** (line 76)

Also delegates to `renderResults()` — cascades automatically.

### Area 2: HTML Renderers

**File: `src/core/viz/htmlRenderer-search.ts`** (line 43, 61)

Current:
```html
<th>Hash</th>
...
<td class="hash">' + esc(r.blobHash.slice(0,7)) + '</td>
```

Proposed:
```html
<th>Blob Hash</th>
...
<td class="hash">blob:' + esc(r.blobHash.slice(0,7)) + '</td>
```

**Why:** Makes it explicit in HTML output; aligns with text output convention.

**File: `src/core/viz/htmlRenderer-evolution.ts`**

Review for consistency; likely shows both `blobHash` and `commitHash`, so verify both are labeled clearly.

**File: `src/core/viz/htmlRenderer-map.ts`**

Review and update as needed.

### Area 3: OpenAPI Documentation

**File: `src/server/routes/openapi.ts`**

Add field descriptions to clarify hash types in JSON responses:

```json
{
  "blobHash": {
    "type": "string",
    "description": "Git blob OID (content-addressed hash, 40 hex chars). Identifies blob content uniquely."
  },
  "firstCommit": {
    "type": "string",
    "description": "Commit hash when this blob was first indexed (40 hex chars). The earliest commit that introduced this blob."
  }
}
```

### Area 4: MCP Tool Interpretations

**File: `src/core/narrator/interpretations.ts`**

Add guidance for `semantic_search`, `code_search`, and related tools:

```
When tools return text with hash values like [blob:abc123], the "blob:" 
prefix indicates a blob hash (content-addressed). If a firstCommit or 
commitHash is present, it's the earliest commit that introduced this blob.
Do not confuse blob hashes (internal) with commit hashes (user-visible).
```

### Area 5: Tests

**File: `tests/ranking.test.ts`**

Add tests:

```typescript
describe('renderResults hash labeling', () => {
  it('should prefix blob hashes with "blob:" for clarity', () => {
    const results = [{ 
      blobHash: 'abcdef0123456789abcdef0123456789abcdef01', 
      paths: ['src/auth.ts'], 
      score: 0.9 
    }]
    const output = renderResults(results, false)
    expect(output).toContain('[blob:abcdef01]')
  })

  it('should show first-seen results with blob: prefix', () => {
    const results = [{ 
      blobHash: 'abc...', 
      paths: ['src/foo.ts'], 
      score: 0.85,
      firstSeen: 1609459200
    }]
    const output = renderFirstSeenResults(results, false)
    expect(output).toContain('[blob:abc]')
  })
})
```

## Implementation Order

1. **Update `ranking.ts`** → `renderResults()` change (1 line)
2. **Test** → `tests/ranking.test.ts` (verify all callers)
3. **Update HTML renderers** → `htmlRenderer-*.ts` (visual consistency)
4. **Update OpenAPI** → `openapi.ts` (API documentation)
5. **Update MCP guidance** → `interpretations.ts` (LLM clarity)
6. **Verify all interfaces** → CLI, MCP, HTTP, HTML, LSP

## Acceptance Criteria

- [ ] CLI: `gitsema search "auth"` output includes `[blob:...]` prefix
- [ ] CLI: `gitsema first-seen` output includes `[blob:...]` prefix
- [ ] CLI: `gitsema code-search` output includes `[blob:...]` prefix
- [ ] MCP: `semantic_search` text output includes `[blob:...]` prefix
- [ ] MCP: `code_search` text output includes `[blob:...]` prefix
- [ ] HTTP: `POST /search?rendered=true` text includes `[blob:...]` prefix
- [ ] HTTP: `POST /first-seen?rendered=true` text includes `[blob:...]` prefix
- [ ] HTML: Search results show "Blob Hash" column or `blob:` prefix
- [ ] HTML: Evolution results clearly distinguish blob vs commit hashes
- [ ] Tests: `tests/ranking.test.ts` passes with new labeling tests
- [ ] No breaking changes to JSON responses (field names unchanged)
- [ ] No breaking changes to structured MCP responses (field names unchanged)

## Testing Strategy

### Unit Tests
- `tests/ranking.test.ts`: Verify `renderResults()` and variants output `[blob:...]`
- `tests/htmlRenderer.test.ts`: Verify HTML renderers show type labels

### Integration Tests
- CLI: Run `gitsema search`, `first-seen`, `code-search` and verify output
- MCP: Verify `semantic_search` and `code_search` outputs via test harness
- HTTP: Test `/search`, `/first-seen` with `rendered=true`
- HTML: Generate HTML output and inspect visually

### Backward Compatibility
- JSON field names (e.g., `blobHash`, `firstCommit`) unchanged — no API break
- Field descriptions added to OpenAPI (no breaking change)
- Text output changed but is human-readable only (not parsed by clients)

## Risk Assessment

**Low Risk:**
- Single-line change to core formatter cascades across all text outputs
- No JSON/structured response changes, only field descriptions
- No database schema changes
- All existing tests should pass (no removal of fields)

**Testing Required:**
- Verify text output in all interfaces (CLI, MCP, HTTP, HTML)
- Verify JSON structures unchanged in HTTP responses
- Verify MCP tools work with new text formatting

## Phasing

This work should be a single phase:
- **Goal:** Eliminate hash type ambiguity across all user-facing outputs
- **Changes:** Core formatter, HTML, OpenAPI, tests, documentation
- **Duration:** ~2–4 hours
- **Review:** Verify text output consistency across all interfaces

## Future Enhancements (Out of Scope)

- Clickable links to blob/commit viewers in web UI
- Add hash type to CSV/tabular exports
- Show full 40-char hash vs abbreviated in different contexts
- Hash validation/parsing utilities for user input
