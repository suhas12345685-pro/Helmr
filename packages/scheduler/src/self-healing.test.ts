import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SelfHealingAgent,
  createJobHealingProbe,
  createJobRemediation,
  createReplanProbe,
  createReplanRemediation,
  type HealableJob,
  type HealingProbe,
  type Incident,
  type Remediation,
  type ReasoningHealingStore,
} from './self-healing.js';
import type { JobStatus } from '../../shared/src/index.js';

class FakeStore implements ReasoningHealingStore {
  jobs = new Map<string, HealableJob>();
  plansCleared: string[] = [];

  constructor(jobs: HealableJob[]) {
    for (const job of jobs) this.jobs.set(job.id, { ...job });
  }

  async listJobs(opts: { status?: JobStatus; limit?: number }): Promise<HealableJob[]> {
    return [...this.jobs.values()].filter((j) => !opts.status || j.status === opts.status);
  }
  async updateJobStatus(id: string, status: JobStatus, error?: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) { job.status = status; job.lastError = error; }
  }
  async getJob(id: string): Promise<HealableJob | undefined> {
    return this.jobs.get(id);
  }
  async clearPlan(jobId: string): Promise<void> {
    this.plansCleared.push(jobId);
  }
}

function job(partial: Partial<HealableJob> & { id: string }): HealableJob {
  return {
    status: 'failed', attempts: 1, maxAttempts: 3,
    updatedAt: new Date().toISOString(), ...partial,
  };
}

test('requeues an active job whose lease expired past the grace window', async () => {
  const store = new FakeStore([
    job({ id: 'a', status: 'running', leaseUntil: '2020-01-01T00:00:00.000Z', attempts: 1 }),
  ]);
  const agent = new SelfHealingAgent({
    probes: [createJobHealingProbe({ store })],
    remediations: [createJobRemediation({ store })],
  });

  const report = await agent.runCycle();
  assert.equal(report.healed, 1);
  assert.equal(store.jobs.get('a')?.status, 'queued');
});

test('fails a stuck job once its retry budget is exhausted', async () => {
  const store = new FakeStore([
    job({ id: 'a', status: 'running', leaseUntil: '2020-01-01T00:00:00.000Z', attempts: 3, maxAttempts: 3 }),
  ]);
  const agent = new SelfHealingAgent({
    probes: [createJobHealingProbe({ store })],
    remediations: [createJobRemediation({ store })],
  });

  await agent.runCycle();
  assert.equal(store.jobs.get('a')?.status, 'failed');
});

test('does not touch a running job whose lease is still valid', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const store = new FakeStore([job({ id: 'a', status: 'running', leaseUntil: future })]);
  const agent = new SelfHealingAgent({
    probes: [createJobHealingProbe({ store })],
    remediations: [createJobRemediation({ store })],
  });

  const report = await agent.runCycle();
  assert.equal(report.detected, 0);
  assert.equal(store.jobs.get('a')?.status, 'running');
});

test('reasoning failures are re-planned, not blindly retried', async () => {
  const store = new FakeStore([
    job({ id: 'a', status: 'failed', attempts: 1, lastError: 'council produced an invalid plan schema' }),
    job({ id: 'b', status: 'failed', attempts: 1, lastError: 'ECONNRESET talking to tool' }),
  ]);
  const agent = new SelfHealingAgent({
    probes: [createJobHealingProbe({ store }), createReplanProbe({ store })],
    remediations: [createJobRemediation({ store }), createReplanRemediation({ store })],
  });

  const report = await agent.runCycle();
  assert.equal(report.detected, 2);
  assert.deepEqual(store.plansCleared, ['a']); // only the reasoning failure cleared its plan
  assert.equal(store.jobs.get('a')?.status, 'queued');
  assert.equal(store.jobs.get('b')?.status, 'queued');
});

test('circuit opens after repeated failed heals and escalates without retrying', async () => {
  const incident: Incident = {
    id: 'i1', subsystem: 'jobs', target: 'a',
    symptom: 'stuck', rootCause: 'unfixable', severity: 'warning',
  };
  let remediateCalls = 0;
  const probe: HealingProbe = { name: 'p', detect: async () => [{ ...incident, id: `i_${Math.random()}` }] };
  const remediation: Remediation = {
    name: 'always-fails',
    canHandle: () => true,
    remediate: async () => { remediateCalls += 1; return { action: 'try' }; },
    validate: async () => false,
  };
  const agent = new SelfHealingAgent({ probes: [probe], remediations: [remediation], breakerThreshold: 2 });

  await agent.runCycle(); // failure 1
  await agent.runCycle(); // failure 2 -> opens circuit
  const third = await agent.runCycle(); // circuit open -> skipped

  assert.equal(remediateCalls, 2);
  assert.equal(third.outcomes[0]?.phase, 'circuit-open');
  assert.equal(third.outcomes[0]?.escalated, true);
});

test('escalates incidents that no remediation can handle', async () => {
  const probe: HealingProbe = {
    name: 'p',
    detect: async () => [{ id: 'i', subsystem: 'mystery', symptom: 's', rootCause: 'r', severity: 'critical' }],
  };
  const agent = new SelfHealingAgent({ probes: [probe], remediations: [] });
  const report = await agent.runCycle();
  assert.equal(report.escalated, 1);
  assert.equal(report.outcomes[0]?.phase, 'unhandled');
});

test('a remediation that throws is surfaced as an escalated error, not a crash', async () => {
  const probe: HealingProbe = {
    name: 'p',
    detect: async () => [{ id: 'i', subsystem: 'jobs', target: 'a', symptom: 's', rootCause: 'r', severity: 'warning' }],
  };
  const remediation: Remediation = {
    name: 'boom', canHandle: () => true,
    remediate: async () => { throw new Error('store offline'); },
    validate: async () => true,
  };
  const agent = new SelfHealingAgent({ probes: [probe], remediations: [remediation] });
  const report = await agent.runCycle();
  assert.equal(report.outcomes[0]?.phase, 'error');
  assert.match(report.outcomes[0]?.detail ?? '', /store offline/);
});

test('hybrid analyzer refines the diagnosis and feeds the knowledge sink', async () => {
  const recorded: string[] = [];
  const probe: HealingProbe = {
    name: 'p',
    detect: async () => [{ id: 'i', subsystem: 'jobs', target: 'a', symptom: 's', rootCause: 'shallow', severity: 'warning' }],
  };
  const remediation: Remediation = {
    name: 'ok', canHandle: () => true,
    remediate: async () => ({ action: 'fixed' }), validate: async () => true,
  };
  const agent = new SelfHealingAgent({
    probes: [probe],
    remediations: [remediation],
    analyzer: (incident) => ({ ...incident, rootCause: `refined: ${incident.rootCause}` }),
    onOutcome: (o) => { recorded.push(o.incident.rootCause); },
  });

  const report = await agent.runCycle();
  assert.equal(report.healed, 1);
  assert.deepEqual(recorded, ['refined: shallow']);
});
