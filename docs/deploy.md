# gitsema Deployment Guide

This document covers production deployment of the `gitsema` HTTP server:
running as a systemd service, Docker usage (with Ollama sidecar), securing API
keys, backing up the index, and tuning recommendations for different repo sizes.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Running as a systemd service](#running-as-a-systemd-service)
3. [Docker / docker-compose](#docker--docker-compose)
4. [Securing API keys](#securing-api-keys)
5. [Backing up the index](#backing-up-the-index)
6. [Model rotation](#model-rotation)
7. [Recommended settings](#recommended-settings)
8. [Observability](#observability)
9. [Rate limiting](#rate-limiting)
10. [Multi-repo deployments](#multi-repo-deployments)
11. [Team operations](#team-operations)

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 18 |
| pnpm | ≥ 9 (or npm ≥ 10) |
| Git | any recent version |
| Ollama **or** OpenAI-compatible API | — |

Install gitsema globally:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm link --global   # puts `gitsema` on PATH
```

---

## Running as a systemd service

Create `/etc/systemd/system/gitsema.service`:

```ini
[Unit]
Description=gitsema HTTP embedding server
After=network.target

[Service]
Type=simple
User=gitsema
Group=gitsema
WorkingDirectory=/var/lib/gitsema/repos/my-repo

# --- Required: embedding backend ---
# Option A: Ollama (local)
Environment="GITSEMA_PROVIDER=ollama"
Environment="GITSEMA_MODEL=nomic-embed-text"

# Option B: OpenAI-compatible remote API
# Environment="GITSEMA_PROVIDER=http"
# Environment="GITSEMA_HTTP_URL=https://api.openai.com"
# Environment="GITSEMA_MODEL=text-embedding-3-small"
# EnvironmentFile=/etc/gitsema/secrets.env   ← contains GITSEMA_API_KEY

# --- Auth ---
EnvironmentFile=/etc/gitsema/secrets.env     # contains GITSEMA_SERVE_KEY

# --- Server settings ---
Environment="GITSEMA_SERVE_PORT=4242"
Environment="GITSEMA_RATE_LIMIT_RPM=300"

ExecStart=/usr/local/bin/gitsema tools serve --port 4242
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Harden the service
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/gitsema

[Install]
WantedBy=multi-user.target
```

**Deploy and start:**

```bash
# Create dedicated user
useradd --system --home /var/lib/gitsema --shell /usr/sbin/nologin gitsema

# Place secrets (chmod 600, owned by root)
install -m 600 -o root -g root /dev/null /etc/gitsema/secrets.env
echo 'GITSEMA_SERVE_KEY=<strong-random-token>' >> /etc/gitsema/secrets.env
# If using a remote embedding API:
# echo 'GITSEMA_API_KEY=sk-...' >> /etc/gitsema/secrets.env

# Enable and start
systemctl daemon-reload
systemctl enable gitsema
systemctl start gitsema
systemctl status gitsema
journalctl -u gitsema -f          # follow logs
```

---

## Docker / docker-compose

### Dockerfile

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-slim
WORKDIR /app
# Only copy production files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# gitsema reads the repo from a mounted volume
VOLUME ["/repo"]
WORKDIR /repo

EXPOSE 4242
ENV GITSEMA_SERVE_PORT=4242
ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["tools", "serve"]
```

### docker-compose.yml (with Ollama sidecar)

```yaml
version: "3.9"

services:
  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama_models:/root/.ollama
    # Wait for Ollama to be ready, then pull the embedding model
    entrypoint: ["/bin/sh", "-c", "ollama serve & until curl -sf http://localhost:11434; do sleep 2; done && ollama pull nomic-embed-text && wait"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434"]
      interval: 10s
      retries: 10

  gitsema:
    build: .
    depends_on:
      ollama:
        condition: service_healthy
    volumes:
      - /path/to/your/repo:/repo      # ← mount your Git repository here
      - gitsema_index:/repo/.gitsema  # ← persist the index separately
    environment:
      GITSEMA_PROVIDER: ollama
      GITSEMA_MODEL: nomic-embed-text
      GITSEMA_HTTP_URL: http://ollama:11434
      GITSEMA_SERVE_PORT: "4242"
      GITSEMA_RATE_LIMIT_RPM: "300"
      # Set a strong token in a .env file (not committed)
      GITSEMA_SERVE_KEY: "${GITSEMA_SERVE_KEY}"
    ports:
      - "4242:4242"
    restart: unless-stopped

volumes:
  ollama_models:
  gitsema_index:
```

**Quick start:**

```bash
# Create .env file (never commit this)
echo 'GITSEMA_SERVE_KEY=change-me-to-a-strong-token' > .env

docker compose up -d

# First-time index (blocks until complete)
docker compose exec gitsema node /app/dist/cli/index.js index
```

**OpenAPI docs** will be available at `http://localhost:4242/docs` after startup.
**Prometheus metrics** at `http://localhost:4242/metrics` (requires the bearer token unless `GITSEMA_METRICS_PUBLIC=1`).

---

## Securing API keys

### gitsema serve key (`GITSEMA_SERVE_KEY`)

- Generate a strong random token: `openssl rand -hex 32`
- Store in a secrets manager (HashiCorp Vault, AWS Secrets Manager, GitHub Actions Secrets) — **never** commit it.
- Pass it to the process via `EnvironmentFile` (systemd) or Docker secrets / compose `.env`.
- All API consumers must include `Authorization: Bearer <token>` on every request.

### Embedding provider API key (`GITSEMA_API_KEY`)

- Same rules apply: random, in a secrets file, never in source control.
- Rotate keys regularly; after rotation run `gitsema config set apiKey ""` (or clear the env var) and restart.

### Encryption at rest

SQLite's `.gitsema/index.db` stores **plaintext source code blobs** in its FTS5 table.  
For sensitive codebases:

1. **Filesystem encryption:** deploy on a LUKS-encrypted volume (Linux) or FileVault/BitLocker drive.
2. **SQLite Encryption Extension (SEE):** commercial; replace `better-sqlite3` with `@journeyapps/sqlcipher` (requires rebuild and schema migration).
3. **At minimum:** restrict OS-level file permissions so only the `gitsema` service account can read `.gitsema/`.

---

## Backing up the index

The entire gitsema state lives in `.gitsema/index.db` (relative to the indexed repo root).

### Online backup (no downtime)

SQLite supports safe online backups via the `.backup` command:

```bash
sqlite3 .gitsema/index.db ".backup /backups/index-$(date +%Y%m%d).db"
```

Or use the SQLite Online Backup API via a Node script for streaming copies.

### Automated daily backup (cron)

```cron
0 3 * * * sqlite3 /var/lib/gitsema/repos/my-repo/.gitsema/index.db ".backup /backups/gitsema/index-$(date +\%Y\%m\%d).db" && find /backups/gitsema -name '*.db' -mtime +30 -delete
```

### Restore

```bash
# Stop the server first, then:
cp /backups/gitsema/index-20250401.db /var/lib/gitsema/repos/my-repo/.gitsema/index.db
systemctl start gitsema
```

---

## Model rotation

When you switch embedding models (e.g. `nomic-embed-text` → `text-embedding-3-small`), existing
vectors are **incompatible** — you must rebuild the index from scratch.

```bash
# 1. Stop the server
systemctl stop gitsema

# 2. Remove the old index (or rename for rollback)
mv .gitsema/index.db .gitsema/index.db.bak

# 3. Update the model environment variable / config
gitsema config set model text-embedding-3-small

# 4. Re-index (may take minutes to hours depending on repo size)
gitsema index --since all

# 5. Restart
systemctl start gitsema
```

> **Tip:** Keep the old index (`index.db.bak`) until you have verified search quality with the new model.

---

## Recommended settings

### Small repo (< 10 000 blobs)

```bash
GITSEMA_RATE_LIMIT_RPM=300
# index
gitsema index --concurrency 4 --chunker file
# search: defaults are fine
```

### Medium repo (10 000 – 100 000 blobs)

```bash
GITSEMA_RATE_LIMIT_RPM=150
# index: increase concurrency if the embedding backend supports it
gitsema index --concurrency 8 --max-size 100kb --chunker function
# search: use early-cut to limit candidate pool
gitsema search "authentication" --early-cut 5000
```

### Large repo (> 100 000 blobs)

```bash
GITSEMA_RATE_LIMIT_RPM=60
# index: pipeline and cap blob sizes
gitsema index --concurrency 16 --max-size 50kb --chunker fixed --window-size 1000 --overlap 100
# Build HNSW approximate nearest-neighbor index after initial indexing
gitsema build-vss
# search: HNSW search is automatic when .vss file exists
```

---

## Observability

### Prometheus metrics

The server exposes a `/metrics` endpoint in Prometheus exposition format.

| Metric | Type | Description |
|---|---|---|
| `http_request_duration_seconds` | histogram | Per-route latency (p50/p95/p99) |
| `gitsema_index_blobs_total` | gauge | Unique blobs in the DB |
| `gitsema_index_embeddings_total` | gauge | Whole-file embeddings stored |
| `gitsema_embedding_errors_total` | gauge | Provider errors since startup |
| `gitsema_query_cache_hits_total` | gauge | Query embedding cache hits |
| `gitsema_query_cache_misses_total` | gauge | Query embedding cache misses |

**Default:** `/metrics` requires the same bearer token as all other routes.  
**Monitoring scrapers:** set `GITSEMA_METRICS_PUBLIC=1` to bypass auth for the metrics endpoint only (use with caution — expose only on an internal network).

#### Example Prometheus scrape config

```yaml
scrape_configs:
  - job_name: gitsema
    static_configs:
      - targets: ['gitsema:4242']
    bearer_token: '<GITSEMA_SERVE_KEY>'
    # Or, when GITSEMA_METRICS_PUBLIC=1:
    # bearer_token: ''
```

#### Example Grafana alert (search latency)

```promql
histogram_quantile(0.95,
  sum by (le, route) (
    rate(http_request_duration_seconds_bucket{app="gitsema"}[5m])
  )
) > 2
```

### Logging

All server output goes to stdout/stderr. Redirect to a log aggregator (Loki, Splunk, etc.) via systemd-journal or Docker's log driver.

Set `GITSEMA_VERBOSE=1` for debug-level output.

---

## Rate limiting

| Env var | Default | Description |
|---|---|---|
| `GITSEMA_RATE_LIMIT_RPM` | `300` | Requests per minute per client |
| `GITSEMA_RATE_LIMIT_BURST` | `= RPM` | Burst allowance (maps to window limit) |

- **When `GITSEMA_SERVE_KEY` is set:** rate-limiting key is the bearer token, so each API consumer has its own independent window.
- **When no auth is configured:** rate-limiting is per source IP.
- Exceeded limits return `429 Too Many Requests` with a `Retry-After` header indicating seconds until the window resets.

---

## Multi-repo deployments

Run separate `gitsema tools serve` instances for each repository (different ports), or use a reverse proxy (nginx, Caddy) to route by path prefix:

```nginx
# nginx example
location /api/repo-a/ {
    proxy_pass http://127.0.0.1:4242/;
    proxy_set_header Authorization "Bearer $repo_a_token";
}

location /api/repo-b/ {
    proxy_pass http://127.0.0.1:4243/;
    proxy_set_header Authorization "Bearer $repo_b_token";
}
```

Each instance is completely isolated — it has its own `.gitsema/index.db`.

For cross-repo search, use the `gitsema repos` command to register repos and the `multi_repo_search` MCP tool or `POST /api/v1/analysis/multi-repo-search`.

---

## Team operations

This section covers shared-server best practices for teams: token rotation, audit logging, and backup / restore drills.

### Token security (review7 §4.1)

Scoped repo tokens are stored as **SHA-256 hashes** in the database — the plaintext is never persisted. Only the first 8 characters (the prefix) are stored for identification.

**Minting a token:**

```bash
gitsema repos token add <repo-id> "ci-pipeline"
# Output:
#   Token minted for repo 'my-repo':
#     a1b2c3d4e5f6...
#   Copy this token now — it cannot be recovered.
```

Copy the full token immediately and store it in your secrets manager (AWS Secrets Manager, Vault, GitHub Actions secrets, etc.). **It cannot be recovered from the DB after this point.**

**Listing tokens (shows only prefix):**

```bash
gitsema repos token list
# Token (prefix)    Repo ID               Label                 Created
# a1b2c3d4...       my-repo               ci-pipeline           2025-01-15
```

**Revoking a token:**

```bash
gitsema repos token revoke a1b2c3d4
# Token revoked: a1b2c3d4...
```

### Token rotation policy

1. **Rotate every 90 days** for long-lived service tokens (or per your org's rotation policy).
2. Rotation procedure:
   - Mint a new token: `gitsema repos token add <repo-id> "<label>-new"`
   - Update the secret in your CI/CD system or secrets manager.
   - Verify the new token works: `curl -H "Authorization: Bearer <new-token>" http://host:4242/health`
   - Revoke the old token: `gitsema repos token revoke <old-prefix>`
3. **Emergency rotation** (suspected token leak):
   - Revoke immediately: `gitsema repos token revoke <prefix>`
   - Mint a replacement and update all consumers within the incident window.
   - Rotate `GITSEMA_SERVE_KEY` (the global key) by restarting the server with a new value.

### Audit logs

gitsema does not currently emit a dedicated audit trail, but you can construct one from the access log:

**Using nginx access logs:**

```nginx
log_format gitsema_audit '$time_iso8601 $request_method $uri $status '
                          '$request_length $bytes_sent '
                          '"$http_authorization"';
access_log /var/log/nginx/gitsema_audit.log gitsema_audit;
```

**Using systemd journal filtering:**

```bash
# All 401/403 responses (unauthorized access attempts)
journalctl -u gitsema --since "1 hour ago" | grep '"status":40[13]'

# All index-write operations
journalctl -u gitsema | grep '"method":"POST".*index'
```

**Recommended Prometheus alert for repeated 401s:**

```promql
rate(http_requests_total{app="gitsema",status="401"}[5m]) > 1
```

Set up this alert to page on-call when there are more than 1 unauthorized request per second (possible brute-force or misconfigured client).

### Backup and restore

The entire index is a single SQLite file at `.gitsema/index.db`. Git history is the source of truth — the index can always be rebuilt from scratch with `gitsema index start`.

**Incremental hot backup (online, no downtime):**

```bash
# SQLite's .backup pragma creates a consistent snapshot even while the server is running
sqlite3 /path/to/repo/.gitsema/index.db ".backup '/backup/gitsema-$(date +%Y%m%d).db'"
```

**Scheduled backup (cron):**

```cron
# Daily backup at 02:00, keeping 7 days
0 2 * * * sqlite3 /var/lib/gitsema/index.db ".backup '/backups/gitsema-$(date +\%Y\%m\%d).db'" \
  && find /backups -name 'gitsema-*.db' -mtime +7 -delete
```

**Restore drill (run quarterly):**

```bash
# 1. Copy backup to a temporary location
cp /backups/gitsema-20250115.db /tmp/gitsema-restore-test.db

# 2. Verify the backup is not corrupt
sqlite3 /tmp/gitsema-restore-test.db "PRAGMA integrity_check;"
# Should return: ok

# 3. Check record counts match original
sqlite3 /tmp/gitsema-restore-test.db "SELECT COUNT(*) FROM blobs;"
sqlite3 /var/lib/gitsema/index.db       "SELECT COUNT(*) FROM blobs;"

# 4. Test a search against the backup
GITSEMA_DB_PATH=/tmp/gitsema-restore-test.db \
  gitsema search "authentication middleware" --top 3

# 5. If restore to production is needed:
systemctl stop gitsema
cp /backups/gitsema-20250115.db /var/lib/gitsema/index.db
systemctl start gitsema
```

**Full re-index from Git (no backup needed):**

```bash
# If the DB is lost or corrupt, rebuild from Git history.
rm -f .gitsema/index.db
gitsema index start
# This re-embeds everything — time depends on repo size and embedding speed.
```

### Health checks

Add a health check to your load balancer or monitoring system:

```bash
# Basic liveness
curl -sf http://localhost:4242/health && echo "OK"

# With auth
curl -sf -H "Authorization: Bearer $GITSEMA_SERVE_KEY" http://localhost:4242/health

# Readiness (check DB is accessible)
curl -sf http://localhost:4242/api/v1/status | jq '.blobCount'
```

**Docker healthcheck:**

```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:4242/health"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```
