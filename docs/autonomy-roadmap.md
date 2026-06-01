# Helmr Autonomy Roadmap

Status: design / planning (not yet implemented)
Last updated: 2026-06-01

This document is the agreed target for turning Helmr from a production-grade
*control plane with a stubbed agent layer* into a production-ready **fully
autonomous** agent. It is a plan, not a description of current behavior. Where it
disagrees with the code, the code has not been built yet.

It is downstream of `soul.md` (the constitution). `soul.md` defines *loyalty —
whose side the agent is on*. This document defines *enforcement — how the agent
is kept from harming that owner by accident or manipulation, even when the model
is wrong, confused, or hijacked.* Both are required. Loyalty is necessary; it is
not sufficient.

---

## 1. Trust Model

Two independent guarantees, often confused:

- **Allegiance (handled by `soul.md`):** the agent serves one Operator, treats
  external content as data not orders, never serves a third party's agenda. This
  decides *which way the agent points.*
- **Behavioral safety (handled by this roadmap):** the agent *cannot* take a
  catastrophic, irreversible action even while perfectly loyal — because the LLM
  is probabilistic, can be confidently wrong, can misread reality, and can be
  manipulated. This decides *that it cannot drive off a cliff while pointing the
  right way.*

The LLM being intelligent gives us allegiance's usefulness and good judgment most
of the time. It does **not** give us behavioral safety: intelligence lowers the
error rate, it never makes it zero, and at thousands of autonomous actions a rare
failure becomes a certainty. The enforcement layer converts "this smart thing
usually does the right thing" into "this smart thing *cannot* do the catastrophic
thing."

Crucially, the enforcement layer is what makes autonomy *more* free, not less:
when every reversible action is checkpointed and contained, the agent can run
fully on its own initiative on reversible work, because mistakes simply rewind.
Brakes are what let it go fast.

---

## 2. Target Architecture: "Own Body, Guarded Edge"

The Operator decides **where** Helmr lives — its own sandbox, a dedicated
personal computer, or a VPS. That deployment choice **is** the primary blast
radius wall, and it is exactly what `soul.md` already assumes: *"The Operator's
real machine is theirs. My agents live in their own bodies."*

**Principle: a box contains what is *inside* it, not what reaches *outside* it.**

A dedicated box solves the largest category of risk on its own:

- The agent cannot touch the Operator's real machine, personal files, keyboard,
  or unrelated projects.
- Filesystem mistakes are contained to the box.
- This lets us **drop heavyweight in-process OS sandboxing** for the local
  filesystem case — the deployment *is* the sandbox.

Four hazards still cross the box's walls and therefore still need enforced gates,
regardless of how isolated the box is:

| Hazard | Contained by the box? | Required control |
| --- | --- | --- |
| Operator's real machine / personal data | Yes | deployment isolation |
| General filesystem mistakes | Yes | deployment isolation |
| Spending money / burning compute | **No** | **budgets + circuit breakers** |
| Irreversible outward actions (email, prod push, third parties) | **No** | **outward-action gate** |
| Credential / secret exposure inside the box | **No** | **scoped, minimal credentials** |
| Wrecking the in-progress work itself | **No** | **checkpoint + rollback** |

So the model is: **isolate the body (Operator's choice), run fully autonomous
inside it, and enforce only at the four edges that escape any box.**

### Deployment is configurable ("the user's wish")

Everything environment-specific is a pluggable backend chosen by config, so the
same Helmr runs from a single laptop up to a VPS or a shared instance:

- Persistence: SQLite (single box) <-> Postgres (`@mastra/pg` already a
  dependency) for shared / multi-instance.
- Same for workspace locks (already lease-based in `packages/scheduler`).
- Identity/auth layer added when it is more than one user.

---

## 3. The Four Edge Boundaries (the real work of full autonomy)

These replace the human approver that full autonomy removes. They are mechanical,
not prompt-based — `soul.md` rules become *enforced*, not *hoped for*.

### 3.1 Budgets & circuit breakers
Per-job and global ceilings on token/$ spend, action count, wall-clock time, and
tool-call rate. Trip -> auto-pause the job and surface it. Wire into the existing
scheduler lease/heartbeat model. Without this, a smart agent in a loop burns money
indefinitely from inside a perfectly isolated box.

### 3.2 Outward-action gate
A typed boundary for actions that leave the box: spending money, sending
messages/emails to third parties, pushing to shared/production branches, posting
to the web, calling APIs with Operator credentials. These get a policy decision
(standing approval for pre-authorized low-risk classes; hard stop otherwise),
distinct from filesystem work which runs free inside the box. Maps to extending
`packages/cortex/src/policy.ts` from binary approve/deny into capability tiers.

### 3.3 Scoped, minimal credentials
The box only holds the credentials the current work needs, at the narrowest scope
(e.g. a repo-scoped token, not an org-wide one; a spend-capped API key). The
sandbox does not protect what is inside the sandbox, so the answer is to put less
inside it. Builds on `packages/config/src/secret-store.ts`; add per-job credential
scoping and move toward encrypted-at-rest / KMS / OS-keyring.

### 3.4 Checkpoint & rollback
Before any write-batch: a git checkpoint (or workspace snapshot) so an autonomous
mistake is one command to revert. Record the checkpoint ref in the audit trail
beside each receipt. This protects the *work-in-progress*, which lives inside the
box and is therefore **not** protected by isolation.

---

## 4. Phased Roadmap

Revised from the original five-phase plan to reflect the box-level deployment
model (which removes most in-process sandboxing) and the full-autonomy target.

### Phase 0 — Fix what is actually broken (prerequisite)
1. Wire `browser_automation` into the gated executor
   (`packages/hands/src/executor.ts` currently throws `unknown tool`).
2. Key-gated live-LLM CI job exercising the real
   `councilAgent/researchAgent/codingAgent.generate()` path (today every test
   forces the offline fallback, so the brain has zero coverage).
3. HTTP-level e2e through Gateway intake -> Hatchery -> runtime -> audit.

### Phase 1 — The four edge boundaries (critical for autonomy)
1. Budgets & circuit breakers (3.1).
2. Outward-action gate + capability tiers in `cortex/policy.ts` (3.2).
3. Scoped, minimal credentials (3.3).
4. Checkpoint & rollback wired into the receipt/audit path (3.4).
5. Kill-switch: global halt + per-agent stop the daemon honors immediately,
   surfaced in Hatchery. (`soul.md`: "Autonomy is a loan of trust, and it can be
   recalled.")

### Phase 2 — LLM reliability (autonomy is only as good as the brain)
1. Provider resilience: timeouts, retries, cross-provider failover in
   `packages/router` (it already models task->model routing).
2. Structured-output validation + repair loops so a malformed plan is regenerated,
   not executed.
3. Eval/regression harness for plan quality, run in CI.
4. Cost & decision observability (`@mastra/observability` + `pino` already
   present).

### Phase 3 — Embodiment hardening
1. Make the browser provider a first-class, gated path (auto-install/onboard
   Playwright; `src/agent-runtime.ts` defaults to mock today).
2. Fold the embodied swarm into the audited job lifecycle so its actions flow
   through receipts + audit like everything else (today `orchestrateSwarm` is a
   parallel subsystem).
3. Per-agent isolation: separate browser context + permission zone per agent
   (scaffolding exists in `packages/embodiment/src/permissions.ts`).

### Phase 4 — Deployment flexibility ("the user's wish")
1. Pluggable persistence: abstract `memory/sqlite-store.ts` behind an interface;
   add a Postgres implementation (`@mastra/pg`). Same for workspace locks.
2. Stateless daemon + externalized state for horizontal scale.
3. Identity/auth layer for team / multi-user.
4. Ship the deployment matrix: existing `Dockerfile` / `docker-compose.yml` /
   `deploy/helmr.service`, plus a Postgres profile and a scale-out profile.

### Phase 5 — Operational readiness
1. Expand self-healing (`packages/scheduler/src/self-healing.ts`) with probes for
   LLM timeouts, provider failover, budget trips, stuck agents — critical when no
   human is watching.
2. Secrets at rest: encrypted / KMS / OS-keyring.
3. Backup/restore automation + forward-version migration rollback.
4. Load + chaos testing; security review of the autonomous tool surface.
5. Turn `docs/production-readiness.md` into the living gate: every item above
   becomes a `helmr self-test` check, so the self-test is the single source of
   truth for "is it ready."

---

## 5. Sequencing & Risk

- **Phase 0 -> 1 are non-negotiable and first.** Full autonomy is not safe to run
  until the four edge boundaries and the kill-switch exist.
- **Phase 2 runs in parallel with Phase 1.**
- **Phases 3-5 are hardening / scale** and follow once the autonomous core is
  safe. Phase 4 can be pulled earlier if multi-user is an immediate need.
- For full autonomy specifically, the majority of the genuine engineering risk is
  **Phase 1** — the edge boundaries. The box-level deployment model removes the
  heaviest part of the original sandbox work, but the four edge controls cannot be
  deployment-solved and must be built.

---

## 6. Definition of Done

Helmr is a production-ready autonomous agent when, on the target deployment:

- It runs in its own body (sandbox / PC / VPS) and cannot reach the Operator's
  real machine or unrelated data.
- Inside the box it acts on its own initiative for reversible work, with no
  per-action prompting.
- All four edges are enforced: spend is capped, outward actions are gated,
  credentials are minimal and scoped, and every write is checkpointed and
  reversible.
- The Operator can see everything (audit trail), pause everything (kill-switch),
  and recall autonomy at any time.
- The LLM path is reliable (failover, repair, evals) and observable.
- `helmr self-test` verifies every gate above, green, on the deployment.
