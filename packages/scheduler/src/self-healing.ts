import { randomUUID } from 'node:crypto';

import type { JobStatus } from '../../shared/src/index.js';

/**
 * Closed-loop self-healing agent.
 *
 * Modeled on reflective self-healing architectures (a supervisory runtime that
 * watches subsystems rather than doing task work): each cycle runs a
 * detect → diagnose → remediate → validate pipeline. Probes detect symptoms
 * and diagnose them into incidents; remediations apply a corrective action and
 * then validate that the incident actually cleared. Anything that cannot be
 * healed is escalated rather than silently dropped.
 */

export type IncidentSeverity = 'info' | 'warning' | 'critical';

export interface Incident {
  id: string;
  subsystem: string;
  /** Observed symptom (the detect step). */
  symptom: string;
  /** Diagnosed root cause (the diagnose step). */
  rootCause: string;
  severity: IncidentSeverity;
  /** Optional identifier of the affected resource (job id, channel kind, ...). */
  target?: string;
}

export interface HealingProbe {
  readonly name: string;
  detect(): Promise<Incident[]>;
}

export interface RemediationAttempt {
  action: string;
  detail?: string;
}

export interface Remediation {
  readonly name: string;
  canHandle(incident: Incident): boolean;
  remediate(incident: Incident): Promise<RemediationAttempt>;
  /** Re-check the subsystem; true means the incident is resolved. */
  validate(incident: Incident): Promise<boolean>;
}

export type HealingPhase = 'remediated' | 'circuit-open' | 'unhandled' | 'error';

export interface HealingOutcome {
  incident: Incident;
  action: string;
  detail?: string;
  healed: boolean;
  escalated: boolean;
  phase: HealingPhase;
}

export interface HealingReport {
  ranAt: string;
  detected: number;
  healed: number;
  escalated: number;
  outcomes: HealingOutcome[];
}

/**
 * Optional deeper-diagnosis hook (the hybrid "Analyze" step). Probes attach a
 * deterministic root cause; when a model is available the daemon can plug in an
 * analyzer that refines the incident (e.g. an LLM root-cause analyzer). It must
 * fall back gracefully — returning the incident unchanged is always valid.
 */
export type IncidentAnalyzer = (incident: Incident) => Incident | Promise<Incident>;

export interface SelfHealingAgentOptions {
  probes: HealingProbe[];
  remediations: Remediation[];
  log?: (message: string) => void;
  now?: () => Date;
  /** Consecutive failed heals on one target before its circuit opens. */
  breakerThreshold?: number;
  /** How long a circuit stays open before a half-open retry is allowed. */
  breakerCooldownMs?: number;
  /** Knowledge sink (the "K" in MAPE-K): persist every outcome. */
  onOutcome?: (outcome: HealingOutcome) => void | Promise<void>;
  /** Hybrid diagnosis refinement; deterministic rules are used when omitted. */
  analyzer?: IncidentAnalyzer;
}

interface BreakerState {
  failures: number;
  openedAt?: number;
}

const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 5 * 60_000;

/**
 * Drives the MAPE-K loop: Monitor (probe.detect) → Analyze (incident.rootCause)
 * → Plan (select remediation) → Execute (remediate + validate), with a shared
 * Knowledge sink. A per-target circuit breaker stops the agent from thrashing
 * on an unfixable target — after repeated failed heals the circuit opens and
 * the incident is escalated until a cooldown allows a half-open retry.
 */
export class SelfHealingAgent {
  private readonly probes: HealingProbe[];
  private readonly remediations: Remediation[];
  private readonly log: (message: string) => void;
  private readonly now: () => Date;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly onOutcome?: (outcome: HealingOutcome) => void | Promise<void>;
  private readonly analyzer?: IncidentAnalyzer;
  private readonly breakers = new Map<string, BreakerState>();

  constructor(options: SelfHealingAgentOptions) {
    this.probes = options.probes;
    this.remediations = options.remediations;
    this.log = options.log ?? (() => {});
    this.now = options.now ?? (() => new Date());
    this.breakerThreshold = options.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
    this.breakerCooldownMs = options.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
    this.onOutcome = options.onOutcome;
    this.analyzer = options.analyzer;
  }

  async runCycle(): Promise<HealingReport> {
    const incidents = await this.detect();

    // Process incidents concurrently to avoid sequential I/O blocking
    const outcomes: HealingOutcome[] = await Promise.all(
      incidents.map(async (raw) => {
        const incident = await this.analyze(raw);
        const outcome = await this.handle(incident);
        if (this.onOutcome) await this.onOutcome(outcome);
        return outcome;
      })
    );

    return {
      ranAt: this.now().toISOString(),
      detected: incidents.length,
      healed: outcomes.filter((o) => o.healed).length,
      escalated: outcomes.filter((o) => o.escalated).length,
      outcomes,
    };
  }

  private async analyze(incident: Incident): Promise<Incident> {
    if (!this.analyzer) return incident;
    try {
      return await this.analyzer(incident);
    } catch (err) {
      this.log(`analyzer failed for "${incident.symptom}": ${err instanceof Error ? err.message : String(err)}`);
      return incident;
    }
  }

  private async handle(incident: Incident): Promise<HealingOutcome> {
    const remediation = this.remediations.find((r) => r.canHandle(incident));
    if (!remediation) {
      this.log(`escalating ${incident.subsystem} incident "${incident.symptom}": no remediation`);
      return { incident, action: 'none', healed: false, escalated: true, phase: 'unhandled' };
    }

    const key = this.breakerKey(incident);
    if (this.isOpen(key)) {
      this.log(`circuit open for ${key}; escalating "${incident.symptom}" without retry`);
      return { incident, action: 'circuit-open', healed: false, escalated: true, phase: 'circuit-open' };
    }

    try {
      const attempt = await remediation.remediate(incident);
      const healed = await remediation.validate(incident);
      this.recordBreaker(key, healed);
      this.log(
        `${healed ? 'healed' : 'unresolved'} ${incident.subsystem}/${incident.target ?? '-'} ` +
          `via ${remediation.name}: ${attempt.action}`,
      );
      return { incident, action: attempt.action, detail: attempt.detail, healed, escalated: !healed, phase: 'remediated' };
    } catch (err) {
      this.recordBreaker(key, false);
      const detail = err instanceof Error ? err.message : String(err);
      this.log(`remediation ${remediation.name} threw for "${incident.symptom}": ${detail}`);
      return { incident, action: remediation.name, detail, healed: false, escalated: true, phase: 'error' };
    }
  }

  private breakerKey(incident: Incident): string {
    return `${incident.subsystem}:${incident.target ?? incident.rootCause}`;
  }

  private isOpen(key: string): boolean {
    const breaker = this.breakers.get(key);
    if (!breaker?.openedAt) return false;
    // Half-open once the cooldown elapses: allow a single trial through.
    if (this.now().getTime() - breaker.openedAt >= this.breakerCooldownMs) return false;
    return true;
  }

  private recordBreaker(key: string, healed: boolean): void {
    if (healed) {
      this.breakers.delete(key);
      return;
    }
    const breaker = this.breakers.get(key) ?? { failures: 0 };
    breaker.failures += 1;
    if (breaker.failures >= this.breakerThreshold) breaker.openedAt = this.now().getTime();
    this.breakers.set(key, breaker);
  }

  private async detect(): Promise<Incident[]> {
    const batches = await Promise.all(
      this.probes.map(async (probe) => {
        try {
          return await probe.detect();
        } catch (err) {
          this.log(`probe ${probe.name} failed: ${err instanceof Error ? err.message : String(err)}`);
          return [] as Incident[];
        }
      }),
    );
    return batches.flat();
  }
}

// --- Built-in job healing -------------------------------------------------

export interface HealableJob {
  id: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  leaseUntil?: string;
  updatedAt: string;
  lastError?: string;
}

export interface SelfHealingStore {
  listJobs(opts: { status?: JobStatus; limit?: number }): Promise<HealableJob[]>;
  updateJobStatus(id: string, status: JobStatus, error?: string): Promise<void>;
  getJob(id: string): Promise<HealableJob | undefined>;
}

export interface JobHealingOptions {
  store: SelfHealingStore;
  now?: () => Date;
  leaseGraceMs?: number;
  scanLimit?: number;
}

const DEFAULT_LEASE_GRACE_MS = 30_000;
const DEFAULT_SCAN_LIMIT = 100;
const ACTIVE_STATUSES: JobStatus[] = ['running', 'planning'];

function newIncident(input: Omit<Incident, 'id'>): Incident {
  return { id: `incident_${randomUUID()}`, ...input };
}

/**
 * Detects jobs the worker loop can strand — active jobs whose lease expired
 * (their worker died) and failed jobs still within their retry budget — and
 * diagnoses each with a root cause for the remediation to act on.
 */
export function createJobHealingProbe(options: JobHealingOptions): HealingProbe {
  const now = options.now ?? (() => new Date());
  const leaseGraceMs = options.leaseGraceMs ?? DEFAULT_LEASE_GRACE_MS;
  const scanLimit = options.scanLimit ?? DEFAULT_SCAN_LIMIT;

  return {
    name: 'jobs',
    async detect() {
      const incidents: Incident[] = [];
      const nowMs = now().getTime();

      const [activeStatusesJobs, failed] = await Promise.all([
        Promise.all(ACTIVE_STATUSES.map(status =>
          options.store.listJobs({ status, limit: scanLimit }).then(jobs => ({ status, jobs }))
        )),
        options.store.listJobs({ status: 'failed', limit: scanLimit })
      ]);

      for (const { status, jobs } of activeStatusesJobs) {
        for (const job of jobs) {
          if (!job.leaseUntil) continue;
          const deadline = new Date(job.leaseUntil).getTime();
          if (Number.isNaN(deadline) || deadline + leaseGraceMs >= nowMs) continue;
          incidents.push(newIncident({
            subsystem: 'jobs',
            target: job.id,
            symptom: `job ${job.id} stuck in ${status} with expired lease`,
            rootCause: 'worker holding the lease died before completing the job',
            severity: 'warning',
          }));
        }
      }

      for (const job of failed) {
        if (job.attempts >= job.maxAttempts) continue;
        // Reasoning-plane failures are owned by the re-plan probe.
        if (isReasoningFailure(job.lastError)) continue;
        incidents.push(newIncident({
          subsystem: 'jobs',
          target: job.id,
          symptom: `job ${job.id} failed with retries remaining (${job.attempts}/${job.maxAttempts})`,
          rootCause: job.lastError ? `transient failure: ${job.lastError}` : 'transient failure',
          severity: 'warning',
        }));
      }

      return incidents;
    },
  };
}

/**
 * Remediates job incidents by requeuing recoverable jobs (or failing them once
 * their retry budget is gone) and validates that the job left its stuck state.
 */
export function createJobRemediation(options: JobHealingOptions): Remediation {
  return {
    name: 'requeue-job',
    canHandle: (incident) => incident.subsystem === 'jobs' && Boolean(incident.target),
    async remediate(incident) {
      const job = await options.store.getJob(incident.target!);
      if (!job) return { action: 'noop', detail: 'job no longer present' };

      if (job.attempts < job.maxAttempts) {
        await options.store.updateJobStatus(job.id, 'queued', `self-healed: ${incident.rootCause}`);
        return { action: 'requeued', detail: `attempt ${job.attempts}/${job.maxAttempts}` };
      }
      await options.store.updateJobStatus(job.id, 'failed', `self-healed: exhausted retries (${incident.rootCause})`);
      return { action: 'failed', detail: 'retry budget exhausted' };
    },
    async validate(incident) {
      const job = await options.store.getJob(incident.target!);
      if (!job) return true;
      return job.status === 'queued' || job.status === 'failed';
    },
  };
}

// --- Built-in reasoning-plane healing ------------------------------------

export interface ReasoningHealingStore extends SelfHealingStore {
  clearPlan(jobId: string): Promise<void>;
}

/** Errors that point at the reasoning plane rather than a transient I/O blip. */
const REASONING_ERROR_PATTERNS = [
  /plan/i,
  /reason/i,
  /agent/i,
  /capabilit/i,
  /invalid.*(output|schema|json)/i,
  /hallucin/i,
];

function isReasoningFailure(error?: string): boolean {
  if (!error) return false;
  return REASONING_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

/**
 * Detects jobs that failed because of a reasoning-plane error (a bad plan,
 * invalid structured output, a capability mismatch) rather than a transient
 * fault. These need a fresh plan, not just a blind retry.
 */
export function createReplanProbe(options: { store: ReasoningHealingStore; scanLimit?: number }): HealingProbe {
  const scanLimit = options.scanLimit ?? DEFAULT_SCAN_LIMIT;
  return {
    name: 'reasoning',
    async detect() {
      const failed = await options.store.listJobs({ status: 'failed', limit: scanLimit });
      return failed
        .filter((job) => job.attempts < job.maxAttempts && isReasoningFailure(job.lastError))
        .map((job) => newIncident({
          subsystem: 'reasoning',
          target: job.id,
          symptom: `job ${job.id} failed in the reasoning plane`,
          rootCause: `planning/agent error: ${job.lastError}`,
          severity: 'warning',
        }));
    },
  };
}

/**
 * Repairs reasoning-plane failures by discarding the stored plan and requeuing
 * the job, forcing the Council to re-plan from scratch. Validates that the job
 * is queued again with no stale plan attached.
 */
export function createReplanRemediation(options: { store: ReasoningHealingStore }): Remediation {
  return {
    name: 'replan-job',
    canHandle: (incident) => incident.subsystem === 'reasoning' && Boolean(incident.target),
    async remediate(incident) {
      const job = await options.store.getJob(incident.target!);
      if (!job) return { action: 'noop', detail: 'job no longer present' };
      await options.store.clearPlan(job.id);
      await options.store.updateJobStatus(job.id, 'queued', `self-healed: re-planning after ${incident.rootCause}`);
      return { action: 'replanned', detail: 'cleared stale plan and requeued' };
    },
    async validate(incident) {
      const job = await options.store.getJob(incident.target!);
      if (!job) return true;
      return job.status === 'queued';
    },
  };
}
