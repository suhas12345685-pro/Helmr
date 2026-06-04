# Helmr vs OpenClaw Production Audit

Date: 2026-06-03.

## Benchmark notes

OpenClaw presents itself as a multi-channel AI gateway with extensive docs, CI, deployment files, plugin SDK, provider/channel ecosystems, security runbooks, and package metadata. Its public repository shows top-level `apps`, `deploy`, `docs`, `extensions`, `packages`, `qa`, `scripts`, `security`, `skills`, `src`, and `test` directories plus README, SECURITY, CONTRIBUTING, CHANGELOG, third-party notices, Docker and release metadata. Helmr should match that maturity while preserving Helmr's dynamic Council/Gateway identity.

## Current Helmr strengths

- TypeScript-first monorepo with Gateway, Scheduler, Memory, Governor, Cortex, Hands, Channels, Skills, Hatchery, and Mastra integration.
- Existing CLI, self-tests, runtime tests, SQLite state, daemon support, rollback/checkpoint hooks, and Hatchery apps.
- Dynamic skills existed before this pass and were not hardcoded into the core runtime.
- Existing deployment files and production-readiness tests provided a foundation.

## Current Helmr faults before this pass

- Root package metadata described a research workspace rather than a shippable product.
- Private Gateway APIs could become open when `HELMR_API_TOKEN` was missing.
- WebSocket protocol was ping/pong only and did not enforce typed envelopes.
- Provider discovery was Anthropic-centric.
- Skills were minimal instruction manifests without permissions, schemas, risk, health, quarantine, or CLI management.
- Plugin/provider SDK contracts were absent.
- Docs were fragmented and lacked a coherent product path.
- CI was too small for release confidence.
- Real deployment verification used safe defaults that could mask missing production secrets.

## Production blockers addressed

- Added fail-closed auth policy and explicit local-only `HELMR_AUTH_MODE=none`.
- Split local production simulation from real deployment verification.
- Added Gateway protocol contracts, SDK skeletons, richer skills, security audit, package smoke testing, CI workflows, Docker/systemd/reverse-proxy guidance, and production checklist.

## Security blockers addressed

- Missing token in production now denies private APIs.
- Public bind hosts require auth.
- Wildcard CORS is flagged for production.
- Constant-time token comparison is used.
- Security doctor checks cover token, production mode, CORS, public bind, state/secrets permissions, provider danger flags, channel exposure, tool permissions, write approval, budgets, audit logs, and backups.

## Docs blockers addressed

- Added focused docs for getting started, architecture, Gateway protocol, security, exposure, deployment, plugin SDK, skills, channels, providers, configuration, troubleshooting, and production readiness.

## Packaging blockers addressed

- Root `package.json` now includes repository/homepage/bugs/keywords/author/packageManager/engines/bin/exports/files/sideEffects and clean scripts.
- Added package smoke script covering pack dry run, temp install, `helmr --help`, and safe local self-test.

## Protocol/plugin blockers addressed

- Added `packages/protocol`, `packages/plugin-sdk`, and `packages/provider-sdk` with Zod contracts and contract tests.
- Gateway WebSocket now sends typed HELLO, validates messages, handles AUTH/HEARTBEAT/JOB_STATUS, and sends typed ERROR envelopes.

## Exact files changed in the modernization pass

See the Git diff for the authoritative list. Major changes include `package.json`, `README.md`, `src/cli.ts`, `packages/gateway/src/http-server.ts`, `packages/shared/src/http-auth.ts`, `packages/skills/src/*`, new `packages/security`, `packages/protocol`, `packages/plugin-sdk`, `packages/provider-sdk`, runtime/governor/channel contract surfaces, `qa/contracts`, `qa/e2e`, docs, deployment templates, workflows, and scripts.

## What remains after this pass

- Full Hatchery UI implementation for every onboarding step.
- Real provider validation for each provider.
- Signed plugins/skills and external marketplace trust chain.
- Fully implemented Slack/Discord/Email/WhatsApp/Teams adapters.
- Production-grade distributed job leases and external audit storage.
- Manual secret provisioning and deployment-specific hardening.
