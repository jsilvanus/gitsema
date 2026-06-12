# `@jsilvanus/chattydeer` — Contract for gitsema-guide function calling

> This document describes the additional API surface that gitsema requires from
> `@jsilvanus/chattydeer` to power the `gitsema guide` interactive chat with
> full function-call (tool-call) execution.  
> The current chattydeer version (`0.2.0`) satisfies narration/explain.  
> Everything in this document is **pending** — it will be implemented in
> chattydeer once this contract is agreed.

---

## Background

`gitsema guide` needs an **agentic loop**:

1. User asks a question.
2. The LLM decides which gitsema tools to call (e.g. `semantic_search`,
   `recent_commits`, `file-evolution`).
3. chattydeer executes the tool calls and feeds results back.
4. Repeat until the LLM returns a final answer.

The current chattydeer `Explainer` API (single-shot text generation) is
sufficient for narrate/explain but cannot support this loop.

---

## Required additions to `@jsilvanus/chattydeer`

### 1. `ChatSession` — multi-turn conversation object

```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Present when role='tool' — the name of the tool that produced this result. */
  toolName?: string
  /** Present when role='assistant' — the tool calls the LLM wants to make. */
  toolCalls?: ToolCall[]
}

interface ToolCall {
  id: string           // unique per call (passed back in tool result)
  name: string         // tool name (e.g. 'semantic_search')
  arguments: Record<string, unknown>  // parsed JSON args
}

interface ChatSession {
  messages: ChatMessage[]
  append(msg: ChatMessage): void
}
```

### 2. `ChatCompletionProvider` — streaming + tool-calling chat

```typescript
interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema object describing the parameters. */
  parameters: Record<string, unknown>
}

interface ChatCompletionRequest {
  session: ChatSession
  tools?: ToolDefinition[]
  /** Max tokens for this completion turn. */
  maxTokens?: number
  /** Temperature (0 = deterministic). */
  temperature?: number
  /** If true, stream token deltas via AsyncIterable<string>. */
  stream?: boolean
}

interface ChatCompletionResponse {
  message: ChatMessage        // the assistant's response (text or tool_calls)
  tokensUsed: number
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error'
}

interface ChatCompletionProvider {
  /** Single completion turn (non-streaming). */
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse>
  /** Streaming completion; yields token deltas until finish. */
  stream(req: ChatCompletionRequest): AsyncIterable<{ delta: string; done: boolean }>
  destroy(): Promise<void>
}
```

### 3. `AgentLoop` — agentic tool-execution helper

```typescript
interface AgentLoopOptions {
  provider: ChatCompletionProvider
  tools: ToolDefinition[]
  /** Callback invoked by AgentLoop to execute a tool call. */
  executeTool(call: ToolCall): Promise<string>
  /** Maximum number of LLM → tool → LLM roundtrips (default: 5). */
  maxRoundtrips?: number
  /** Callback for observing intermediate messages (optional). */
  onMessage?: (msg: ChatMessage) => void
}

interface AgentLoopResult {
  answer: string          // final assistant text
  messages: ChatMessage[] // full conversation history
  roundtrips: number      // number of tool-call roundtrips used
}

/** Run an agentic loop until the LLM produces a final answer (no more tool_calls). */
function runAgentLoop(session: ChatSession, opts: AgentLoopOptions): Promise<AgentLoopResult>
```

### 4. Factory function

```typescript
/**
 * Create a ChatCompletionProvider backed by any OpenAI-compatible endpoint.
 *
 * @param httpUrl  Base URL (e.g. 'https://api.openai.com')
 * @param model    Model name (e.g. 'gpt-4o-mini')
 * @param apiKey   Optional bearer token
 */
function createChatProvider(
  httpUrl: string,
  model: string,
  apiKey?: string,
): ChatCompletionProvider
```

### 5. OpenAI-compatible `/v1/chat/completions` pass-through (optional)

For `gitsema tools serve` to expose a full OpenAI-compatible HTTP endpoint,
chattydeer should optionally provide an Express middleware / handler:

```typescript
/**
 * Returns an Express RequestHandler that proxies POST /v1/chat/completions
 * requests to the configured provider, with optional tool injection.
 *
 * gitsema uses this to expose its tool registry as OpenAI function calls
 * to any compatible client (e.g. Claude Desktop, Continue.dev).
 */
function createOpenAiChatHandler(
  provider: ChatCompletionProvider,
  tools?: ToolDefinition[],
  executeTool?: (call: ToolCall) => Promise<string>,
): RequestHandler
```

---

## gitsema tool registry (to be exposed as function calls)

The following gitsema internal tools will be registered with the agent loop:

| Tool name             | Description                                   | Key parameters           |
|-----------------------|-----------------------------------------------|--------------------------|
| `semantic_search`     | Vector similarity search over git history     | `query`, `topK`          |
| `recent_commits`      | Fetch N most recent commits                   | `n`                      |
| `file_evolution`      | Semantic drift of a single file               | `path`, `since`, `until` |
| `concept_evolution`   | Concept drift across the codebase             | `query`, `topK`          |
| `repo_stats`          | Basic repository statistics                   | —                        |
| `narrate_repo`        | Return commit evidence for a range            | `since`, `until`, `focus`|
| `explain_topic`       | Return commits matching a topic               | `topic`, `since`, `until`|
| `branch_summary`      | Semantic summary of a branch vs main          | `branch`                 |

---

## Redaction requirement

Before any user/tool content is sent to a remote provider, the chattydeer
`AgentLoop` must support a `redactContent` hook:

```typescript
interface AgentLoopOptions {
  // ... (existing fields)
  /** Optional: called on every message before it leaves gitsema. Modify in place. */
  redactContent?: (text: string) => string
}
```

gitsema will wire `redactAll` from `src/core/narrator/redact.ts` here.

---

## Versioning

- Targeting chattydeer `>= 0.3.0` for `ChatCompletionProvider` + `AgentLoop`.
- OpenAI pass-through handler targeted for `>= 0.4.0`.
- gitsema will pin `@jsilvanus/chattydeer@^0.3.0` once these are released.

---

## Acceptance criteria for gitsema

- [ ] `gitsema guide "What does the auth module do?"` performs semantic_search, feeds results to LLM, returns answer.
- [ ] `gitsema guide --interactive` supports multi-turn conversation with tool calls.
- [ ] `POST /api/v1/guide/chat` uses the agent loop (same tools, same redaction).
- [ ] `POST /v1/chat/completions` on the gitsema HTTP server is OpenAI-compatible.
- [ ] All tool call arguments and results are redacted before leaving the process.
- [ ] Agent loop terminates within `maxRoundtrips` (default 5).
