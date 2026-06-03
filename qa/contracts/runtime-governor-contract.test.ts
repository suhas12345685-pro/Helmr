import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateGovernor } from '../../packages/governor/src/index.js';
import { DurableJobRegistry, auditHash, verifyAuditHash } from '../../packages/runtime/src/index.js';

test('governor requires approval, denies kill-switch and budget overruns', () => {
  assert.equal(evaluateGovernor({ budgetRemainingUsd: 1, allowedTools: ['read'], allowedChannels: ['cli'] }, { tool: 'read', channel: 'cli', risk: 'high' }).status, 'approval_required');
  assert.equal(evaluateGovernor({ killSwitch: true, budgetRemainingUsd: 1, allowedTools: ['read'], allowedChannels: ['cli'] }, { risk: 'low' }).status, 'denied');
  assert.equal(evaluateGovernor({ budgetRemainingUsd: 0.01, allowedTools: ['read'], allowedChannels: ['cli'] }, { estimatedCostUsd: 2, risk: 'low' }).status, 'denied');
});

test('runtime supports idempotency, lease retry, pause/resume/cancel and audit tamper detection', () => {
  const registry = new DurableJobRegistry();
  const first = registry.upsert({ id: 'job1', idempotencyKey: 'idem', status: 'running', attempts: 0, leaseExpiresAt: new Date(Date.now() - 1000).toISOString(), payload: {} });
  const dupe = registry.upsert({ id: 'job2', idempotencyKey: 'idem', status: 'queued', attempts: 0, payload: {} });
  assert.equal(dupe.id, first.id);
  assert.equal(registry.retryExpired().at(0)?.status, 'queued');
  assert.equal(registry.pause('job1'), true);
  assert.equal(registry.resume('job1'), true);
  assert.equal(registry.cancel('job1'), true);
  const hash = auditHash([{ a: 1 }]);
  assert.equal(verifyAuditHash([{ a: 1 }], hash), true);
  assert.equal(verifyAuditHash([{ a: 2 }], hash), false);
});
