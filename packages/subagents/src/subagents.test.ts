import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { HelmrPlan, PlanStep } from '../../shared/src/index.js';
import {
  computeParallelBatches,
  maxBatchWidth,
  runWithConcurrency,
  executePlanSteps,
} from './index.js';

function step(id: string, parallel: string[] = []): PlanStep {
  return {
    id,
    title: id,
    kind: 'read',
    agent: 'none',
    canRunInParallelWith: parallel,
    requiredCapabilities: ['workspace_read'],
  };
}

function plan(steps: PlanStep[]): HelmrPlan {
  return {
    id: 'plan_1',
    jobId: 'job_1',
    summary: 'test',
    risk: 'low',
    requiresApproval: false,
    steps,
  };
}

// ── batching ────────────────────────────────────────────────────────

test('mutually parallel steps share a batch', () => {
  const batches = computeParallelBatches([
    step('a', ['b']),
    step('b', ['a']),
    step('c'),
  ]);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0]?.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(batches[1]?.map((s) => s.id), ['c']);
});

test('one-sided parallel declaration does not merge', () => {
  const batches = computeParallelBatches([step('a', ['b']), step('b')]);
  assert.equal(batches.length, 2);
  assert.equal(maxBatchWidth(batches), 1);
});

test('a step only merges when parallel with every member of the batch', () => {
  // a<->b mutual, c mutual with a but not b -> c starts its own batch
  const batches = computeParallelBatches([
    step('a', ['b', 'c']),
    step('b', ['a']),
    step('c', ['a']),
  ]);
  assert.deepEqual(batches.map((b) => b.map((s) => s.id)), [['a', 'b'], ['c']]);
});

test('sequential plan yields single-step batches', () => {
  const batches = computeParallelBatches([step('a'), step('b'), step('c')]);
  assert.equal(batches.length, 3);
});

// ── concurrency pool ────────────────────────────────────────────────

test('runWithConcurrency preserves order and bounds parallelism', async () => {
  let active = 0;
  let peak = 0;
  const out = await runWithConcurrency(
    [1, 2, 3, 4, 5],
    async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    },
    2,
  );
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
  assert.ok(peak <= 2, `peak concurrency ${peak} should not exceed 2`);
});

// ── executePlanSteps ────────────────────────────────────────────────

test('executePlanSteps collects outputs keyed by step id', async () => {
  const p = plan([step('a', ['b']), step('b', ['a']), step('c')]);
  const { results, outputs } = await executePlanSteps(p, async (s) => `out:${s.id}`);
  assert.equal(results.length, 3);
  assert.deepEqual(outputs, { a: 'out:a', b: 'out:b', c: 'out:c' });
});

test('executePlanSteps continues on error by default and records the failure', async () => {
  const p = plan([step('a'), step('b'), step('c')]);
  const { results, outputs } = await executePlanSteps(p, async (s) => {
    if (s.id === 'b') throw new Error('boom');
    return `out:${s.id}`;
  });
  assert.equal(results.find((r) => r.stepId === 'b')?.ok, false);
  assert.match(results.find((r) => r.stepId === 'b')?.error ?? '', /boom/);
  assert.equal(outputs['a'], 'out:a');
  assert.equal(outputs['c'], 'out:c');
  assert.equal(outputs['b'], undefined);
});

test('executePlanSteps can fail fast when continueOnError is false', async () => {
  const p = plan([step('a'), step('b')]);
  await assert.rejects(
    () =>
      executePlanSteps(
        p,
        async (s) => {
          if (s.id === 'b') throw new Error('stop');
          return s.id;
        },
        { continueOnError: false },
      ),
    /stop/,
  );
});
