/**
 * Generic remote-delegation client (Phase 113 — LSP & MCP fleshout, Phase A).
 *
 * Both `gitsema tools lsp --remote` and `gitsema tools mcp --remote` use this
 * single client to forward data-access calls to a running `gitsema tools
 * serve` instance's `POST /api/v1/protocol/:operation` route, instead of
 * querying the local DB session directly. See docs/lsp_and_mcp_fleshout.md §2.
 */

export interface RemoteConfig {
  url: string
  key?: string
  /** Abort the request after this many ms. Default 10000. */
  timeoutMs?: number
}

function buildHeaders(key?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers['Authorization'] = `Bearer ${key}`
  return headers
}

/**
 * Calls a single named remote operation (`lsp.hover`, `mcp.semantic_search`,
 * etc.) and returns its `result`. Throws on network failure, timeout, non-2xx
 * response, or an `{ error }` response body.
 */
export async function callRemote<T>(opName: string, args: unknown, cfg: RemoteConfig): Promise<T> {
  const base = cfg.url.replace(/\/$/, '')
  const url = `${base}/api/v1/protocol/${encodeURIComponent(opName)}`
  const timeoutMs = cfg.timeoutMs ?? 10000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(cfg.key),
      body: JSON.stringify({ args }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Remote protocol error ${res.status} at ${opName}: ${text}`)
    }
    const json = (await res.json()) as { result?: T; error?: string }
    if (json.error) throw new Error(json.error)
    return json.result as T
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Remote call to ${opName} timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Health check against `GET /api/v1/status`, used at startup so `--remote`
 * fails fast with a clear error instead of silently falling back to local
 * mode (docs/lsp_and_mcp_fleshout.md §3.3).
 */
export async function checkRemoteHealth(cfg: RemoteConfig): Promise<void> {
  const base = cfg.url.replace(/\/$/, '')
  const url = `${base}/api/v1/status`
  const timeoutMs = cfg.timeoutMs ?? 10000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', headers: buildHeaders(cfg.key), signal: controller.signal })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Remote health check failed: ${res.status} ${text}`)
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Remote health check at ${url} timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
