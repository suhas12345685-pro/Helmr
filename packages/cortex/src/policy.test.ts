import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluatePlan,
  evaluateToolReceipt,
  hasStandingApproval,
  getSkillAutonomy,
} from './policy.js';

test('autonomous owner self-extends without approval at any risk', () => {
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'low' }, { trustLevel: 'owner', autonomy: 'autonomous' }),
    true,
  );
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'high' }, { trustLevel: 'owner', autonomy: 'autonomous' }),
    true,
  );
});

test('standing mode auto-approves only low-risk owner skill writes', () => {
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'low' }, { trustLevel: 'owner', autonomy: 'standing' }),
    true,
  );
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'high' }, { trustLevel: 'owner', autonomy: 'standing' }),
    false,
  );
});

test('standing approval is withheld for non-owners, manual mode, or non-skill writes', () => {
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'low' }, { trustLevel: 'trusted', autonomy: 'autonomous' }),
    false,
  );
  assert.equal(
    hasStandingApproval({ capability: 'skill_write', risk: 'low' }, { trustLevel: 'owner', autonomy: 'manual' }),
    false,
  );
  assert.equal(
    hasStandingApproval({ capability: 'workspace_write', risk: 'low' }, { trustLevel: 'owner', autonomy: 'autonomous' }),
    false,
  );
});

test('getSkillAutonomy defaults to autonomous and respects explicit dials', () => {
  assert.equal(getSkillAutonomy({}), 'autonomous');
  assert.equal(getSkillAutonomy({ HELMR_SKILL_AUTONOMY: 'whatever' }), 'autonomous');
  assert.equal(getSkillAutonomy({ HELMR_SKILL_AUTONOMY: 'standing' }), 'standing');
  assert.equal(getSkillAutonomy({ HELMR_SKILL_AUTONOMY: 'manual' }), 'manual');
  assert.equal(getSkillAutonomy({ HELMR_SKILL_AUTONOMY: 'MANUAL' }), 'manual');
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
