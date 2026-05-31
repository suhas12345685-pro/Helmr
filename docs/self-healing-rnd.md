# R&D: Helmr Self-Healing Agent

Status: research-backed design, implemented in `packages/scheduler` + `packages/channels`
Last researched: 2026-05-31

## 1. Problem

Helmr runs autonomous agent work as durable jobs across a control plane (queue,
locks, channels), a reasoning plane (Council/Coding/Research agents), and an
execution plane (Hands tools). Any of these can fail *after* a job is admitted:
a worker process dies mid-job and leaves a stale lease; a transient tool/model
error fails a job that should be retried; a channel adapter's socket drops; a
workspace lock is orphaned; the audit chain or store becomes unreachable.

A retry counter alone is **not** self-healing. The literature is explicit that
localized resilience (retries, circuit breakers) "[does] not inherently
diagnose the root cause or orchestrate broader system-level recovery." Helmr
needs a component that **detects, diagnoses, repairs, and validates** recovery
autonomously, and **escalates** what it cannot fix.

## 2. Method

Reviewed primary and secondary sources across three bodies of work:

1. **Autonomic computing / MAPE-K** — IBM's self-managing control loop
   (Monitor → Analyze → Plan → Execute over shared Knowledge), the canonical
   blueprint for self-healing systems.
2. **Reflective self-healing for LLM agents** — VIGIL (2025), a reflective
   *runtime that supervises a sibling agent and performs autonomous maintenance
   rather than task execution*, structured as a **state-gated pipeline** where
   illegal transitions raise explicit errors instead of letting the model
   improvise, and which can even perform **meta-level self-repair** of its own
   diagnostic machinery and resume where it failed.
3. **Resilience patterns + agent failure taxonomy** — circuit breakers (with a
   half-open retest state), bulkheads, reconciliation, escalation routing; and
   the **AgentErrorTaxonomy** (Memory, Reflection, Planning, Action, System
   failures) plus the observation that single root-cause errors **cascade**
   through downstream decisions.

## 3. Findings that shaped the design

- **MAPE-K is the loop.** Detect (Monitor), diagnose into a root cause
  (Analyze), choose a remediation (Plan), apply + verify (Execute), and keep a
  Knowledge record. Helmr's agent implements exactly these phases.
- **Separate the healer from the workers (VIGIL).** Self-healing is a
  supervisory concern. Helmr runs the healing loop in the daemon, *beside* the
  job worker and channel supervisor — it never does user-facing task work.
- **State-gated, not improvised.** Each remediation must `validate()` that the
  incident actually cleared; an unvalidated "fix" is treated as unresolved and
  escalated. No optimistic success.
- **Circuit breakers prevent thrash and cascades.** Repeated failed heals on
  the *same target* open a per-target circuit; the incident is escalated
  without retry until a cooldown allows a single half-open trial. This is the
  documented defense against a root-cause error cascading into a retry storm.
- **Escalation is a first-class outcome.** When no remediation applies, the
  circuit is open, or validation fails, the agent records an escalated outcome
  (for human/owner handoff) rather than silently dropping it.
- **Meta-resilience.** A probe or remediation that itself throws is caught and
  surfaced as an explicit `error`/`escalated` outcome — the healer noticing its
  own machinery failing, instead of crashing the daemon.

## 4. Helmr failure taxonomy → probes & remediations

Mapping the AgentErrorTaxonomy "System" class onto Helmr's concrete subsystems:

| Subsystem | Symptom (Monitor) | Root cause (Analyze) | Remediation (Execute) | Validate |
| --- | --- | --- | --- | --- |
| Jobs | active job with expired lease | worker died holding the lease | requeue (or fail if retries exhausted) | status is `queued`/`failed` |
| Jobs | `failed` with retries left | transient tool/model error | requeue with backoff | status left `failed` state |
| Channels | adapter in `failed` state | socket/gateway dropped | stop → markPaired → start | status is `active` |

The probe/remediation pair is an extension point: locks (orphaned workspace
locks) and storage/audit (unreachable store, broken hash chain) are the next
subsystems to add behind the same interface.

## 5. Architecture (as built)

```
            ┌──────────────── SelfHealingAgent (MAPE-K) ────────────────┐
 Monitor →  │  probes[].detect()  ──►  Incident{symptom, rootCause}      │
 Analyze →  │  (diagnosis carried on the incident)                       │
 Plan    →  │  remediations.find(canHandle) + per-target circuit breaker │
 Execute →  │  remediate() ──► validate() ──► HealingOutcome             │
 Knowledge →│  onOutcome(outcome)  ──►  audit log + dream/heal journal    │
            └────────────────────────────────────────────────────────────┘
```

- `SelfHealingAgent` (`packages/scheduler/src/self-healing.ts`) owns the loop,
  the circuit breaker, and the Knowledge sink (`onOutcome`).
- `HealingProbe` / `Remediation` are the pluggable detect/diagnose and
  repair/validate interfaces.
- Built-ins: `createJobHealingProbe` + `createJobRemediation` (scheduler) and
  `createChannelHealingProbe` + `createChannelRemediation` (channels).
- The daemon runs `runCycle()` on an interval, recording outcomes.

## 6. Validation

Unit tests assert the researched behaviors, not just the happy path: stale-lease
detection and requeue, retry-budget exhaustion → fail, transient-failure
requeue, circuit opening after repeated failed heals + half-open recovery after
cooldown, escalation when no remediation handles an incident, probe/remediation
errors surfaced as escalations, and channel restart-on-failure.

## 7. Sources

- [The Vision of Autonomic Computing (MAPE-K)](https://www.researchgate.net/publication/2955831_The_Vision_Of_Autonomic_Computing)
- [VIGIL: A Reflective Runtime for Self-Healing Agents (arXiv 2512.07094)](https://arxiv.org/abs/2512.07094)
- [A Self-Healing Framework for Reliable LLM-Based Autonomous Agents](https://www.researchgate.net/publication/404712514_A_Self-Healing_Framework_for_Reliable_LLM-Based_Autonomous_Agents)
- [Resilience Circuit Breakers for Agentic AI](https://medium.com/@michael.hannecke/resilience-circuit-breakers-for-agentic-ai-cc7075101486)
- [Self-Healing Infrastructure: Agentic AI in Auto-Remediation Workflows](https://www.algomox.com/resources/blog/self_healing_infrastructure_with_agentic_ai/)
- [Where LLM Agents Fail and How They Can Learn From Failures (AgentErrorTaxonomy, arXiv 2509.25370)](https://arxiv.org/abs/2509.25370)
- [Self-Healing Systems using AI based Auto-Remediation Strategies (Infosys)](https://www.infosys.com/iki/techcompass/self-healing-systems.html)
