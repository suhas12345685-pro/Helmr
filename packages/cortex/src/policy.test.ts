import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluatePlan, evaluateToolReceipt } from './policy.js';

test('read-only plan is allowed without approval', () => {
  const decision = evaluatePlan({
    id: 'plan_1',
    jobId: 'job_1',
    summary: 'read workspace',
    risk: 'low',
    requiresApproval: false,
    steps: [
      {
        id: 'step_1',
        title: 'read files',
        kind: 'read',
        agent: 'coding',
        canRunInParallelWith: [],
        requiredCapabilities: ['workspace_read'],
      },
    ],
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresApproval, false);
});

test('write plan is gated by approval', () => {
  const decision = evaluatePlan({
    id: 'plan_2',
    jobId: 'job_1',
    summary: 'write file',
    risk: 'medium',
    requiresApproval: true,
    steps: [
      {
        id: 'step_1',
        title: 'write file',
        kind: 'write',
        agent: 'coding',
        canRunInParallelWith: [],
        requiredCapabilities: ['workspace_write'],
      },
    ],
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresApproval, true);
});

test('approved receipt is executable and denied receipt is blocked', () => {
  assert.equal(
    evaluateToolReceipt({
      id: 'receipt_1',
      jobId: 'job_1',
      stepId: 'step_1',
      tool: 'reader',
      capability: 'workspace_read',
      input: {},
      risk: 'low',
      approval: 'not_required',
      createdAt: '2026-05-28T10:00:00.000Z',
    }).allowed,
    true,
  );

  assert.equal(
    evaluateToolReceipt({
      id: 'receipt_2',
      jobId: 'job_1',
      stepId: 'step_1',
      tool: 'writer',
      capability: 'workspace_write',
      input: {},
      risk: 'high',
      approval: 'denied',
      createdAt: '2026-05-28T10:00:00.000Z',
    }).allowed,
    false,
  );
});
