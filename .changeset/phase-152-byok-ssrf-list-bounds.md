---
"gitsema": patch
---

Security (Phase 152 / review11 §3.1 + §3.3). **BYOK SSRF guard:** on
`tools serve`, a caller-supplied `byok.http_url` is now validated before the
server calls it — non-`http(s)` schemes and hosts resolving to loopback,
link-local (incl. the `169.254.169.254` cloud-metadata IP), or RFC-1918
private ranges are rejected by default. Operators re-permit specific internal
hosts (e.g. a local model server) via the new `GITSEMA_BYOK_ALLOW_HOSTS`
allowlist. This is a behavior change for anyone pointing BYOK at a
`localhost`/private endpoint — add the host to the allowlist. **List-tool
bounds:** the network-exposed `deps` and `blast_radius` `depth` parameter is
now upper-bounded (max 64) on both the HTTP route and MCP tool, closing the
last unbounded traversal-depth input from the Phase 147/148 exposure.
