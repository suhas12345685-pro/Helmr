# Autonomy Implementation — Status

Last updated: 2026-06-01

Honest record of what is built vs. planned, against `docs/autonomy-roadmap.md`
and `docs/phase1-implementation-plan.md`. "Done" means implemented, integrated,
and covered by passing tests on this branch. No phase is marked done that isn't.

## Verification on this branch

- `npm test` — **277 tests pass** (was 238).
- `helmr self-test` / `verify-production` — **21/21 checks** (added kill_switch,
  budget_limits, outward_gate).
- `npm run build:web`, `npm run build:tui`, `create-helmr` tests — all green.

## Phase 0 — Fix what is broken

| Item | Status |
| --- | --- |
| `browser_automation` wired into the gated executor (Playwright perception path; resolves the prior `unknown tool` gap) | **Done** |
| WebMCP adopted as the preferred, governed browser surface | **Designed** (recorded in roadmap; discovery hook lands with the embodiment driver `evaluate` extension) |
| Key-gated live-LLM CI job | **Not done** (needs a CI secret; the failover utility below is the offline-testable half) |
| HTTP-level e2e through Gateway + Hatchery | **Not done** |

## Phase 1 — The four edge boundaries + kill-switch

| Item | Status |
| --- | --- |
| Capability taxonomy (inward vs outward) — `packages/shared/src/capabilities.ts` | **Done** |
| Policy tiers `auto/standing/gated` + outward-action gate — `packages/cortex/src/policy.ts` | **Done** |
| Budgets & circuit breakers (spend/actions/time/rate) — `packages/scheduler/src/budget.ts` | **Done** |
| Kill-switch (global + per-agent, durable) — `packages/scheduler/src/kill-switch.ts` | **Done** |
| Checkpoint & rollback — `packages/hands/src/checkpoint.ts` | **Done** |
| Scoped, minimal credentials — `packages/config/src/credential-broker.ts` | **Done** (module + tests) |
| Runtime integration: kill-switch entry guard, between-step kill/budget checks, checkpoint+auto-rollback on the write path | **Done** (`src/runtime.ts`, e2e in `src/autonomy.test.ts`) |
| CLI recall: `helmr halt [reason] [--agent <id>]`, `resume`, `halts` | **Done** |
| Self-test gates for the substrate | **Done** |
| Credential broker wired to inject scoped child-process env in the executor | **Partial** (broker is built + tested; executor injection point is the remaining wiring) |
| Budget recording of real LLM token spend | **Partial** (action/time/rate live; USD-from-usage needs the live-LLM wrapper) |

## Phase 2 — LLM reliability

| Item | Status |
| --- | --- |
| Provider failover/retry with backoff — `packages/router/src/resilience.ts` | **Done** (module + tests) |
| Wire failover around the Mastra agent calls in `src/runtime.ts` | **Not done** (utility ready; integration pending) |
| Structured-output validation + repair loop | **Partial** (planning workflow already has a repair fallback; not generalized) |
| Eval/regression harness for plan quality | **Not done** |
| Cost & decision observability | **Not done** |

## Phase 3 — Embodiment hardening

| Item | Status |
| --- | --- |
| Browser provider as a first-class gated path | **Partial** (executor case + Playwright driver done; default still mock, opt-in via `HELMR_WORKSPACE_PROVIDER=browser`) |
| Fold embodied swarm into the audited receipt lifecycle | **Not done** |
| Per-agent isolation (context + permission zone) | **Existing scaffolding** in `packages/embodiment` |

## Phase 4 — Deployment flexibility

| Item | Status |
| --- | --- |
| Pluggable persistence SQLite ↔ Postgres | **Not done** (`@mastra/pg` available; store interface extraction pending) |
| Stateless daemon + externalized state | **Not done** |
| Identity/auth for multi-user | **Not done** (single bearer token today) |
| Deployment matrix (Docker/systemd/Windows) | **Existing** (`Dockerfile`, compose, `deploy/helmr.service`) |

## Phase 5 — Operational readiness

| Item | Status |
| --- | --- |
| Self-healing probes for LLM timeouts / budget trips / stuck agents | **Not done** (MAPE-K loop exists for leases/channels) |
| Secrets encrypted at rest / KMS / keyring | **Not done** (owner-only `0600` today) |
| Backup/restore + forward-version migration rollback | **Partial** (backup/restore exists; forward rollback open) |
| Load + chaos testing; security review of the autonomous surface | **Not done** |
| `helmr self-test` as the single readiness gate | **Extended** (now covers the autonomy substrate; full coverage as phases land) |

## Honest summary

The **load-bearing safety substrate is real and integrated**: an autonomous job
can be recalled instantly (kill-switch), is capped on spend/actions/time/rate
(budgets), reverts its own write mistakes (checkpoint/rollback), classifies and
gates outward actions (policy tiers), and can be handed only the credentials it
needs (broker). This is the part that makes *full autonomy inside the box* safe,
and it is the highest-risk engineering in the whole plan.

The remaining Phase 2–5 work (multi-tenant Postgres + clustering, KMS, live
chaos/load testing, full real-browser embodiment, live-LLM CI and eval harness)
is **not** complete and is not claimed to be. Those require live credentials,
infrastructure, and time beyond a single working session, and several are
genuinely multi-week efforts. They are tracked above so the gap is visible
rather than hidden.
