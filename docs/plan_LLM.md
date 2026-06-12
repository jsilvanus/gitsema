# docs/plan_LLM.md — LLM Narrator/Explainer Integration

## 0) Status

**Implemented** (phase 91+ in `docs/PLAN.md`).  
Depends on: `@jsilvanus/chattydeer` ^0.2.0, `@jsilvanus/embedeer` ^1.3.2.

---

## 1) Goals

- Produce a clear, human-readable narrative of "what changed" over a commit range.
- Produce a bug/error timeline: when it appeared, commits around it, likely fixes.
- Integrate with the existing `gitsema models` system using DB-backed config (`embed_config` table, `kind='narrator'`).
- Safe-by-default: no remote LLM calls unless explicitly configured.
- Auditable output: every narrative includes commit hash citations.
- Scalable: stream `git log`, batch/map-reduce summarisation — no OOM on large repos.

## 2) Non-goals

- Not a full GitHub Issues/PR ingestion pipeline (optional future enrichment).
- Not an always-on background daemon.
- Not a deep semantic code audit (that's `gitsema search` + `gitsema security-scan`).
- Not a replacement for the vector/BM25 search; purely a narrative layer.

---

## 3) User-facing API

### CLI

```bash
# Generate a development history narrative
gitsema narrate [--since <ref|date>] [--until <ref|date>] [--range <rev-range>]
                [--focus bugs|features|ops|security|deps|performance|all]
                [--format md|text|json]
                [--max-commits <n>]
                [--narrator-model-id <id> | --model <name>]

# Explain a bug or error topic
gitsema explain <topic>
                [--since <ref|date>] [--until <ref|date>]
                [--log <error-log-path>]
                [--format md|text|json]
                [--narrator-model-id <id> | --model <name>]
```

### Narrator model management (via `gitsema models`)

```bash
# Add a narrator model config (stored in DB, kind='narrator')
gitsema models narrator-add gpt4o --http-url https://api.openai.com --key sk-... [--activate]

# List narrator configs
gitsema models narrator-list [--json]

# Set the active narrator
gitsema models narrator-activate gpt4o

# Remove a narrator config
gitsema models narrator-remove gpt4o
```

### HTTP (parity)

```
POST /api/v1/narrate   — { since?, until?, range?, focus?, format?, maxCommits?, narratorModelId?, model? }
POST /api/v1/explain   — { topic, since?, until?, format?, narratorModelId?, model? }
```

Response shape: `{ prose, commitCount, citations[], redactedFields[], llmEnabled, format }`

### MCP (parity)

```
narrate_repo           — same args as POST /narrate
explain_issue_or_error — same args as POST /explain
```

---

## 4) Inputs / Data sources

**Required (local, offline)**
- `git log` streamed via `execSync` (commit hash, date, author, subject, body)
- Default window: last 500 commits (configurable via `--max-commits`)
- Hard cap: 5 000 commits max to prevent OOM

**Optional (user-provided)**
- Error log / stack trace file (`--log <path>`, capped at 8 KB)
- Future: git blame for specific files (bounded)

---

## 5) Core pipeline (scalable)

```
git log (streaming, up to N commits)
    ↓
Event extraction + classification (bugfix, feature, security, deps, perf, ops)
    ↓
Focus filtering (--focus flag)
    ↓
Map-reduce summarisation (batch_size=100 commits → LLM → merge)
    ↓
Final narrative prompt (batch summaries + top 10 notable commits)
    ↓
LLM → prose + citations
```

Explain mode:
```
git log (streaming) → keyword match against topic
    ↓
Relevant commit timeline (up to 30 commits)
    ↓
Optional: error log excerpt (capped 2 KB)
    ↓
LLM → incident timeline with citations
```

---

## 6) DB-backed narrator model config

Narrator configs share the `embed_config` table with embedding configs, distinguished by `kind = 'narrator'` (added in schema v22). The `params_json` column stores narrator-specific params as JSON:

```json
{
  "httpUrl": "https://api.openai.com",
  "apiKey": "sk-...",
  "maxTokens": 512,
  "temperature": 0.3
}
```

The active narrator selection is stored in the `settings` table under the key `active_narrator_model_config_id`.

Resolution order for narrator provider:
1. `--narrator-model-id <id>` CLI option (explicit `embed_config.id`)
2. `--model <name>` CLI option (lookup by name in `embed_config`)
3. Active narrator config from `settings` table
4. Disabled (safe-by-default, no network calls)

---

## 7) Security / privacy

- **Redaction pass** before every LLM call (see `src/core/narrator/redact.ts`):
  - AWS access/secret keys
  - GitHub PATs (`ghp_`, `github_pat_`)
  - OpenAI `sk-` keys
  - Google `AIza` keys
  - JWTs (three-segment base64url)
  - PEM private key blocks
  - Generic env-style `SECRET=`, `TOKEN=` assignments
  - Private IP addresses, email addresses
- `--include-diff` default = false (no code content sent to LLM)
- Payload hard cap: git log capped at `maxCommits`, log file capped at 8 KB
- **Safe-by-default**: no network calls when no narrator model is configured

### Audit logging

Every narration call produces a structured audit log entry (`[llm_audit]`) in `.gitsema/gitsema.log` recording: operation, service, model, duration, success, and redacted field names. The entry never contains the actual prompt or response text.

---

## 8) LLM backend (`@jsilvanus/chattydeer`)

The `ChattydeerNarratorProvider` adapter:
1. Creates a `LLMAdapter` with a custom `generateFn` that calls the configured OpenAI-compatible HTTP endpoint (no local HuggingFace model download required for remote providers).
2. Wraps in `Explainer.explain()` for structured, citation-validated output.
3. Falls back to a disabled placeholder when no `httpUrl` is configured.

The chattydeer `Explainer` validates that:
- Output is valid JSON with `{ explanation, labels, references, meta }` shape.
- All `references[].id` values map back to provided evidence IDs.
- Repairs malformed JSON with a single retry prompt.

---

## 9) Tests

| Test file | Coverage |
|---|---|
| `tests/narratorRedact.test.ts` | Redaction: pattern matching, email, JWT, private IP, env-secret |
| `tests/narratorConfig.test.ts` | DB-backed config: save/list/activate/delete, active selection |
| `tests/narratorSmoke.test.ts` | CLI narrate/explain handlers with mock provider (disabled + enabled) |

---

## 10) Acceptance criteria

- [x] `gitsema narrate` returns coherent narrative with commit citations (or safe placeholder when unconfigured)
- [x] `gitsema explain "error text"` returns a timeline with cited commits
- [x] Handles large repos without OOM (stream + batching, configurable cap)
- [x] Redacts secrets-like strings before remote calls
- [x] Safe-by-default: no network calls unless narrator model is configured
- [x] DB-backed config: add/list/activate/remove via `gitsema models narrator-*`
- [x] HTTP parity: `POST /api/v1/narrate`, `POST /api/v1/explain`
- [x] MCP parity: `narrate_repo`, `explain_issue_or_error`
- [x] Uses `@jsilvanus/chattydeer` (not legacy embedeer explainer path)
- [x] Audit log entry written for every narration call
- [x] CI green

---

## 11) Schema changes (v22)

```sql
-- Added to embed_config:
ALTER TABLE embed_config ADD COLUMN kind TEXT DEFAULT 'embedding';
ALTER TABLE embed_config ADD COLUMN params_json TEXT;

-- New table:
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Known `settings` keys:
- `active_narrator_model_config_id` — INTEGER embed_config.id of the active narrator config

---

## 12) Package changes

| Package | Before | After |
|---|---|---|
| `@jsilvanus/embedeer` | (older version) | `^1.3.2` |
| `@jsilvanus/chattydeer` | not installed | `^0.2.0` (new) |
