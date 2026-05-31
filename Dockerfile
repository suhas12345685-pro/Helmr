# Helmr self-hosted control plane (Gateway + Hatchery API).
# Multi-stage: a full build image compiles TypeScript, the runtime image
# ships only production dependencies and the compiled output.

# ---- build stage -------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY packages ./packages

# Compiles src + packages into dist/ (the control plane the daemon runs).
RUN npm run build:ts

# ---- runtime stage -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production

# git is a hard runtime dependency: Helmr's Hands tools shell out to git
# for read (status/log) and gated write (add/commit) operations.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# dist/ already contains the compiled src, packages, and apps.
COPY --from=build /app/dist ./dist

# Durable state (SQLite + JSONL audit) lives on a mounted volume so it
# survives container restarts. These match docs/production-readiness.md.
ENV HELMR_DATA_DIR=/var/lib/helmr/data \
    HELMR_CONFIG_DIR=/var/lib/helmr/config \
    HELMR_AUDIT_DIR=/var/lib/helmr/data/audit

RUN mkdir -p /var/lib/helmr/data /var/lib/helmr/config \
    && useradd --system --uid 10001 --home-dir /home/helmr --create-home helmr \
    && chown -R helmr:helmr /var/lib/helmr /app /home/helmr

USER helmr
VOLUME ["/var/lib/helmr"]

# Gateway: 3999, Hatchery API: 4000 (see src/daemon.ts defaults).
EXPOSE 3999 4000

# /health is a public, unauthenticated process-health endpoint by design.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3999/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/src/cli.js"]
CMD ["start", "all"]
