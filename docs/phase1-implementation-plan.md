# Phase 1 — Implementation Plan: The Four Edge Boundaries + Kill-Switch

Status: design / planning (not yet implemented)
Last updated: 2026-06-01

This expands Phase 1 of `docs/autonomy-roadmap.md` into a concrete, file-level
plan. Phase 1 is the critical path: it is the enforced substrate that makes full
autonomy safe inside the agent's own body. Nothing here is built yet.

Recall the model: the deployment (sandbox / PC / VPS) contains everything *inside*
the box. Phase 1 builds enforcement only for the four hazards that escape any box,
plus a kill-switch that can recall autonomy at any moment.

---

## 0. Shared foundations (build first)

### 0.1 Capability taxonomy: inward vs outward
File: `packages/shared/src/contracts.ts`

Annotate every `Capability` as `inward` (contained by the box: `workspace_read`,
`workspace_write`, `shell_read`, `shell_write`, `git_read`, `git_write` to local
refs) or `outward` (escapes the box: `git_push`, `http_write`/`network`,
`message_send`, `email_send`, `payment`, `package_publish`, `browser` mutations /
WebMCP tool calls that submit). Add a `capabilityDirection(cap)` helper.

### 0.2 Policy tiers
File: `packages/cortex/src/policy.ts`

Replace the binary allow/deny + requiresApproval with three tiers:
- `auto` — inward, reversible. Runs with no prompt.
- `standing` — outward but a pre-authorized class within budget (config-driven).
- `gated` — outward, high-blast-radius. Hard stop -> awaiting authority.

`evaluateToolReceipt(receipt, policy, budgetState)` returns a tier + reason.

### 0.3 New job/audit states and tables
Files: `packages/memory/src/sqlite-store.ts`, `packages/memory/src/audit-jsonl.ts`

- Job statuses: add `paused_budget`, `paused_killswitch`, `rolled_back`.
- Tables: `budgets`, `control_flags`, `credential_grants`; add `checkpointRef`
  column to receipts.
- Audit record kinds: add `budget`, `gate_decision`, `checkpoint`, `killswitch`.
- Bump `schema_migrations` version.

---

## 1. Edge — Budgets & circuit breakers

New: `packages/governor/src/budget.ts` (+ `index.ts`, `budget.test.ts`)

- `BudgetLedger` keyed by `jobId`, persisted in the `budgets` table, tracking
  spend (USD), token usage, action count, wall-clock, and a sliding tool-call
  rate. Limits resolved from config (see below); a restart does not reset spend.
- `check(jobId, projectedCost)` -> `{ allowed, trippedLimit? }`. `record(...)`
  after each action/LLM call.
- LLM cost capture: wrap the agent calls (`packages/mastra` or
  `packages/router`) so the AI-SDK `usage` is converted to USD via a per-model
  price table and fed to `record`.

Integration: `src/runtime.ts`
- Before each receipt execution and each LLM call: `governor.check(...)`. On trip
  -> set job `paused_budget`, append a `budget` audit record, return a paused
  result. Resumable after the Operator raises the cap or approves.

Config: `packages/config`
- `HELMR_BUDGET_USD_PER_JOB`, `HELMR_BUDGET_USD_PER_DAY`,
  `HELMR_MAX_ACTIONS_PER_JOB`, `HELMR_MAX_JOB_SECONDS`,
  `HELMR_TOOL_RATE_PER_MIN`. Sensible safe defaults.

---

## 2. Edge — Outward-action gate

Files: `packages/cortex/src/policy.ts`, `packages/hands/src/executor.ts`,
`packages/config` (standing-approval policy file), `src/runtime.ts`

- Outward capabilities route through the gate (0.2). `auto` inward work is
  untouched and runs free.
- Standing-approval policy (config): a declarative file listing pre-authorized
  outward classes with constraints, e.g. `git_push` allowed to branches matching
  `claude/*` but `main` denied; `http_write` allowed to an allow-listed host set;
  `payment` always `gated`.
- New / completed outward executor cases (currently absent): `git_push`,
  `http_request` (method-aware: GET inward, POST/PUT/DELETE outward),
  `send_message` (routed via `packages/channels`), and the browser/WebMCP
  mutation path from Phase 0. Each consults the gate before executing and writes
  a `gate_decision` audit record.
- A `gated` decision pauses the job to `awaiting_approval` and surfaces in
  Hatchery, exactly like today's plan-approval flow.

---

## 3. Edge — Scoped, minimal credentials

New: `packages/config/src/credential-broker.ts` (+ test). Builds on
`secret-store.ts`.

- `CredentialBroker.grant(jobId, requiredCapabilities)` returns the minimal env
  subset those capabilities need (e.g. a repo-scoped git token for `git_push`,
  not the whole secret store), recorded (names only, never values) in
  `credential_grants` + audit.
- Executor change: `packages/hands` runs each tool with a **scoped env** rather
  than inheriting full `process.env`. Shell/process tools pass the filtered env to
  the child process; the broker injects only granted keys for the duration of the
  receipt.
- Encrypted-at-rest / KMS / OS-keyring is Phase 5; Phase 1 only narrows exposure.

---

## 4. Edge — Checkpoint & rollback

New: `packages/hands/src/checkpoint.ts` (+ test)

- Before any write-batch (a receipt carrying a write/`git_write` capability):
  create a checkpoint. Git workspace -> a commit on a shadow ref or
  `git stash create` (capture ref). Non-git workspace -> a tar snapshot under the
  data dir. Returns a `checkpointRef`.
- Store `checkpointRef` on the receipt and append a `checkpoint` audit record.
- Auto-rollback: on job failure, budget trip mid-write, or kill-switch during a
  write, revert to the last checkpoint and mark the job `rolled_back`.
- CLI: `helmr rollback <jobId>` in `src/cli.ts` to revert a job's changes on
  demand.

Integration: `src/runtime.ts` write path (`executeReadPlan` and the coding-agent
path) wraps execution as checkpoint -> execute -> verify -> (auto-rollback on
anomaly).

---

## 5. Kill-switch (build this first — highest safety/effort ratio)

New: `packages/scheduler/src/kill-switch.ts` (+ test)

- Durable flag in the `control_flags` table (global halt) plus optional
  per-agent entries, with an in-process fast-path cache.
- `isHalted(scope?)`, `halt(scope?, reason)`, `resume(scope?)`.

Integration:
- `src/runtime.ts`: check `isHalted()` between steps and before each receipt;
  on halt -> finish/interrupt the current action, checkpoint-rollback if mid-write,
  set job `paused_killswitch`, append a `killswitch` audit record.
- `packages/embodiment/src/agent-brain.ts`: check `isHalted(agentId)` at the top
  of the loop (around line 81) so embodied agents stop within one step.
- CLI: `helmr halt`, `helmr resume`, `helmr halt --agent <id>` in `src/cli.ts`.
- Hatchery: a stop control in `packages/hatchery-api/src/server.ts` +
  `apps/hatchery-web` (an emergency-stop button). Satisfies `soul.md`: "Autonomy
  is a loan of trust, and it can be recalled."

---

## 6. Suggested build order within Phase 1

1. Shared foundations (0.1-0.3) — taxonomy, tiers, schema. Everything depends on
   these.
2. Kill-switch (5) — small, immediately raises safety, unblocks running anything
   autonomously at all.
3. Budgets (1) — stops runaway spend/loops.
4. Checkpoint & rollback (4) — makes inward work safely reversible so the agent
   can run free inside the box.
5. Outward-action gate (2) — governs the edges; depends on 0.1/0.2 and benefits
   from budgets (1) being present.
6. Credential scoping (3) — narrows what an outward action can even reach.

---

## 7. Testing & self-test

- Unit tests per module (budget trips, gate tiering, checkpoint round-trip +
  rollback, kill-switch halt/resume, credential scoping).
- Extend `src/e2e-job.test.ts` (or a new `src/autonomy.test.ts`) with: a job that
  trips a budget pauses and is resumable; an outward `git_push` to `main` is
  `gated`; a mid-write halt auto-rolls-back to a clean tree; a scoped job cannot
  read an ungranted secret.
- Add `helmr self-test` checks (`src/self-test.ts` / `production-readiness.ts`):
  budgets configured, kill-switch reachable, checkpoint backend available,
  outward-gate policy file present. Per the roadmap, self-test is the single
  source of truth for "is it ready."

---

## 8. Definition of done (Phase 1)

- Inside the box, inward/reversible work runs fully autonomous with no prompting.
- Spend, actions, time, and rate are capped; a trip pauses and is resumable.
- Every outward action is classified and either runs under standing approval or
  is gated to explicit authority — and is auditable as a `gate_decision`.
- Every write is checkpointed; any failure/halt mid-write auto-reverts; a job's
  changes can be rolled back on demand.
- Jobs run with minimal, scoped credentials.
- A global and per-agent kill-switch halts work within one step, from CLI and
  Hatchery, with rollback of in-flight writes.
- `helmr self-test` verifies all of the above.
