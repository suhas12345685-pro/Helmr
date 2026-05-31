import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { HelmrPlan, PlanStep } from '../../shared/src/index.js';
import {
  buildCouncilReport,
  renderCouncilReport,
  mergeSubResults,
  planStepIds,
  type SubResult,
} from './index.js';

function step(id: string, title: string): PlanStep {
  return {
    id,
    title,
    kind: 'read',
    agent: 'none',
    canRunInParallelWith: [],
    requiredCapabilities: ['workspace_read'],
  };
}

const PLAN: HelmrPlan = {
  id: 'plan_1',
  jobId: 'job_1',
  summary: 'Inspect the workspace and report findings.',
  risk: 'low',
  requiresApproval: false,
  steps: [step('a', 'Inspect tree'), step('b', 'Read package.json'), step('c', 'Git status')],
};

test('buildCouncilReport tallies ok, failed, and missing steps', () => {
  const results: SubResult[] = [
    { stepId: 'a', ok: true, output: { files: ['x.ts'] } },
    { stepId: 'b', ok: false, error: 'parse error' },
    // c missing
  ];
  const report = buildCouncilReport(PLAN, results);
  assert.equal(report.completed, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.missing, 1);
  assert.equal(report.sections.length, 3);
  assert.equal(report.sections.find((s) => s.stepId === 'b')?.status, 'failed');
  assert.equal(report.sections.find((s) => s.stepId === 'c')?.status, 'missing');
});

test('report flattens shell stdout/stderr output into detail', () => {
  const report = buildCouncilReport(PLAN, [
    { stepId: 'c', ok: true, output: { stdout: 'clean', stderr: '' } },
  ]);
  assert.match(report.sections.find((s) => s.stepId === 'c')?.detail ?? '', /clean/);
});

test('renderCouncilReport produces a markdown answer with status markers', () => {
  const md = renderCouncilReport(buildCouncilReport(PLAN, [{ stepId: 'a', ok: true, output: 'done' }]), 'inspect it');
  assert.match(md, /# Result/);
  assert.match(md, /Request: inspect it/);
  assert.match(md, /✓ Inspect tree/);
  assert.match(md, /· Git status/); // missing marker
});

test('mergeSubResults is deterministic across identical inputs', () => {
  const results: SubResult[] = [{ stepId: 'a', ok: true, output: 'one' }];
  assert.equal(mergeSubResults(PLAN, results, 'q'), mergeSubResults(PLAN, results, 'q'));
});

test('planStepIds returns ordered step ids', () => {
  assert.deepEqual(planStepIds(PLAN), ['a', 'b', 'c']);
});
