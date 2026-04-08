# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy dependency manifests first (better layer caching)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and compile TypeScript → dist/
COPY . .
RUN pnpm build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Only copy what is needed at runtime
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# gitsema reads the Git repository from a mounted volume
VOLUME ["/repo"]
WORKDIR /repo

EXPOSE 4242

ENV GITSEMA_SERVE_PORT=4242

ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["tools", "serve"]
