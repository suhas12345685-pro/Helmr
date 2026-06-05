# Helmr

Helmr is a dynamic, self-hosted, TypeScript-first AI agent platform. It combines a **Gateway** control plane, **Council** decision brain, Hatchery onboarding, dynamically loaded skills, memory, channels, approvals, budgets, audit logs, and safe long-running jobs.

Helmr exists for operators who want an adaptable AI workspace that can talk, browse when approved, act through governed tools, remember, schedule work, coordinate sub-agents, and expose channels without becoming a static assistant or an unsafe shell wrapper.

## How Helmr differs from OpenClaw/Hermes-style platforms

OpenClaw and mature Hermes-style gateways demonstrate strong packaging, channels, plugin ecosystems, and docs. Helmr keeps a different identity: self-hosted orchestration centered on Council decisions, dynamic runtime skill loading, policy-governed execution, and BYOAK provider setup. This repository uses those products as benchmarks without copying their internals.

## Architecture

- **Gateway**: HTTP/WebSocket control-plane and routing hub.
- **Council**: observes requests, classifies tasks, selects skills/providers, estimates risk, plans, asks approvals, and summarizes.
- **Governor**: enforces approvals, budgets, kill-switch, tool/channel permissions, rate limits, retries, rollback, and safe failure.
- **Runtime**: durable jobs, idempotency, leases, pause/resume, cancellation, job status streams, receipts, and audit verification.
- **Skills**: runtime-loaded capability modules with manifests, permissions, schemas, risk, approvals, health checks, and quarantine for malformed skills.
- **Hatchery**: Personal/Enterprise onboarding for providers, channels, skills, autonomy, budgets, and memory.

## Install

Helmr is currently in Beta. You can install it using npm or via one-line installation scripts.

### 1. npm

```bash
npm i -g helmr
```

### 2. One-liners

**macOS and Linux**
```bash
curl -fsSL https://helmr.ai/install.sh | bash
```

**Windows**
```powershell
powershell -c "irm https://helmr.ai/install.ps1 | iex"
```

### Meet your lobster

```bash
helmr onboard
```

For development:

```bash
npm ci
npm run build:ts
node dist/src/cli.js --help
```

## Quickstart

```bash
helmr self-test
helmr security audit
helmr skills list
helmr ask "summarize this workspace"
```

## Security warning

`/health` is public. Private APIs fail closed when `HELMR_PRODUCTION=true`, `NODE_ENV=production`, `HELMR_REQUIRE_AUTH=true`, or the Gateway binds to a public host. Local unauthenticated development requires explicit `HELMR_AUTH_MODE=none` and is rejected in production.

## Production readiness status

This modernization adds production-grade contracts, docs, CI, deployment templates, and fail-closed security posture. Real deployments still require operator-provided secrets, allowed origins, state directories, audit log and backup paths, channel credentials, and provider keys.

## Commands

- `helmr ask <text>`: run a Council-guided job.
- `helmr start`: start Gateway and Hatchery.
- `helmr security audit`: inspect exposure and secret posture.
- `helmr skills list|inspect|enable|disable|doctor|validate`: manage dynamic skills.
- `helmr policy init`: initialize approval policy.
- `helmr halt|resume|kill-switch`: control safe autonomy.
- `helmr rollback <jobId>`: rollback a checkpointed job.
- `helmr backup <dir>`: copy local state/config to a backup directory.

## Docs

Start with [Getting started](docs/getting-started.md), [Architecture](docs/architecture.md), [Gateway protocol](docs/gateway-protocol.md), [Security](docs/security.md), [Deployment](docs/deployment.md), [Skills](docs/skills.md), [Plugin SDK](docs/plugin-sdk.md), [Providers](docs/providers.md), [Channels](docs/channels.md), and the [Production checklist](docs/production-checklist.md).

## Roadmap

- Signed skill/plugin verification.
- Fully durable distributed runtime leases.
- Real Slack/Discord/Email adapters behind pairing and allowlists.
- Rich Hatchery UI for every onboarding step.
- External audit backends and backup/restore automation.
