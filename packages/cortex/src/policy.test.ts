import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluatePlan,
  evaluateToolReceipt,
  hasStandingApproval,
  getSkillAutonomy,
} from './policy.js';

test('owner has standing approval for low-risk skill writes', () => {
  assert.equal(
    hasStandingApproval(
      { capability: 'skill_write', risk: 'low' },
      { trustLevel: 'owner', autonomy: 'standing' },
    ),
    true,
  );
});

test('standing approval is withheld for non-owners, high risk, manual mode, or other writes', () => {
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'low' }, { trustLevel: 'trusted', autonomy: 'standing' }),
    false,
  );
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'high' }, { trustLevel: 'owner', autonomy: 'standing' }),
    false,
  );
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'low' }, { trustLevel: 'owner', autonomy: 'manual' }),
    false,
  );
  assert.equal(
    hasStandingApproval({ capability: 'workspace_write', risk: 'low' }, { trustLevel: 'owner', autonomy: 'standing' }),
    false,
  );
});

test('getSkillAutonomy defaults to standing and respects manual override', () => {
  assert.equal(getSkillAutonomy({}), 'standing');
  assert.equal(getSkillAutonomy({ HELMR_SKILL_AUTONOMY: 'manual' }), 'manual');
  assert.equal(getSkillAutonomy({ HELMR_SKILL_AUTONOMY: 'MANUAL' }), 'manual');
  assert.equal(getSkillAutonomy({ HELMR_SKILL_AUTONOMY: 'whatever' }), 'standing');
});

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
