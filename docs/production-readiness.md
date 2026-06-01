# Helmr Production Readiness Gate

Status: active hardening gate
Last updated: 2026-05-31

Helmr is production-grade only when every gate below is true and verified on the target deployment.

## Required Runtime Configuration

Production deployments must set:

```txt
HELMR_PRODUCTION=true
HELMR_API_TOKEN=<32+ character random token>
HELMR_ALLOWED_ORIGINS=<comma-separated HTTPS origins>
HELMR_MAX_BODY_BYTES=1048576
HELMR_RATE_LIMIT_PER_MINUTE=120
HELMR_DATA_DIR=<explicit durable data directory>
HELMR_CONFIG_DIR=<explicit durable config directory>
HELMR_AUDIT_DIR=<optional explicit append-only audit directory>
HELMR_MODEL=<provider/model selected during onboarding>
```

`helmr self-test` fails in production mode when the API token is missing or short, allowed origins are missing or wildcarded, request limits are unsafe, or data/config directories are not explicit.

## Security Gates

- HTTP APIs require `Authorization: Bearer <HELMR_API_TOKEN>` when `HELMR_API_TOKEN` is set.
- Bearer token comparison uses constant-time comparison for equal-length token values.
- `/health` remains public for process health checks.
- Browser-facing API responses include baseline security headers, CSP, and cross-origin isolation headers.
- Hatchery CORS allows only `HELMR_ALLOWED_ORIGINS` in production deployments.
- HTTP APIs reject invalid or oversized `Content-Length` values.
- HTTP API responses include `X-Request-Id` for tracing.
- HTTP APIs apply a fixed-window per-client rate limit.
- Write tools remain gated through receipts and approval checks.
- Provider keys are configured intentionally during onboarding or runtime setup, not forced to a single vendor.
- Provider keys configured at runtime persist to an owner-only (0600) `secrets.json` and are restored at startup; environment-injected secrets take precedence over the on-disk store.

## Reliability Gates

- Queued jobs with expired leases can be claimed again.
- Non-running terminal job states clear stale leases.
- Workspace locks release one acquired lock at a time.
- Daemon PID records preserve ports and support status/stop for combined Gateway and Hatchery runs.
- Runtime, Gateway, Hatchery, receipt tools, CLI admin commands, and self-test use the same `HELMR_DATA_DIR` and `HELMR_CONFIG_DIR` resolver.
- SQLite initialization applies versioned, reversible migrations and records each applied version in `schema_migrations`.
- Schema upgrades and rollbacks take an automatic SQLite snapshot first, and rollbacks are available via `helmr migrate rollback <version>`.
- Online SQLite backups use SQLite snapshot semantics rather than raw live-file copies.
- Backup/restore automation preserves the control-plane database, hash-chained audit evidence, and config files.
- JSONL audit logs are hash-chained per job and can be verified for tampering.
- `helmr self-test` checks that the audit hash-chain verifier is available.

## Verification Commands

Run these before calling a build production-ready:

```powershell
npm run typecheck
npm test
npm --prefix apps/hatchery-web run build
npm --prefix apps/hatchery-tui run build
npm --prefix packages/create-helmr test
$env:HELMR_PRODUCTION='true'
$env:HELMR_API_TOKEN='0123456789abcdef0123456789abcdef'
$env:HELMR_ALLOWED_ORIGINS='http://localhost:4000'
$env:HELMR_DATA_DIR="$env:USERPROFILE\.helmr\data"
$env:HELMR_CONFIG_DIR="$env:USERPROFILE\.helmr\config"
node dist/src/cli.js self-test
```

The same local verification bundle is available as:

```powershell
npm run verify
npm run verify:production
```

`npm run verify:production` runs the local build/test bundle, then executes `helmr self-test` with `HELMR_PRODUCTION=true` and hardened local defaults for token, CORS origin, rate limit, body limit, data directory, and config directory. Any explicitly configured production values are preserved so unsafe deployment settings still fail the gate.

## Remaining Hardening Before Public Production Scale

- Add persistent secret storage instead of process-only provider key configuration. (Done:
  `SecretStore` (`packages/config/src/secret-store.ts`) persists provider keys to
  `secrets.json` under the config directory with owner-only (0600) permissions; keys are
  restored into the environment at daemon/Hatchery/CLI startup, with environment-injected
  secrets taking precedence. An encrypted-at-rest / OS-keyring backend remains a future option.)
- Add rollback/backup guidance for future database migrations. (Done: reversible, versioned
  migrations live in `packages/memory/src/migrations.ts` with a runner that applies forward
  migrations and an automated `rollbackSchema` down-path. The store takes an automatic
  `VACUUM INTO` snapshot under `migration-backups/` before any upgrade or rollback, legacy
  single-version databases are backfilled so intermediate rollbacks work, and
  `helmr migrate status` / `helmr migrate rollback <version>` expose it operationally.)
- Add deployment packaging for Docker, systemd, and Windows service installation. (Done:
  `Dockerfile`, `docker-compose.yml`, `deploy/helmr.service`, and Windows/NSSM guidance in
  `docs/deployment.md`.)
- Add end-to-end tests that run a full approved job through Gateway, Hatchery approval, runtime
  execution, and audit review. (Done: `src/e2e-job.test.ts` runs the full intake → plan →
  policy → execute → audit-verify lifecycle in-process and asserts tamper detection, and
  `src/http-e2e-job.test.ts` drives the same control plane over HTTP — Gateway `POST /api/events`
  intake, a read-only job to a verifiable result, and an approval-gated plan that pauses, is
  approved/denied through Hatchery's HTTP `/api/approvals` endpoints, and re-queues or fails
  accordingly — verifying the audit hash-chain throughout.)
- Add backup/restore tests for SQLite state and JSONL audit evidence. (Done:
  `packages/memory/src/backup.test.ts` snapshots and restores SQLite control-plane rows,
  hash-chained audit evidence, and config files.)
