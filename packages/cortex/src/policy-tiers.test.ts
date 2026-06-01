import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateAutonomousReceipt, resolveOutwardPolicy } from './policy.js';
import type { ToolReceipt } from '../../shared/src/index.js';

function receipt(partial: Partial<ToolReceipt>): ToolReceipt {
  return {
    id: 'r1',
    jobId: 'job1',
    stepId: 's1',
    tool: 't',
    capability: 'workspace_read',
    input: {},
    risk: 'low',
    approval: 'not_required',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...partial,
  };
}

test('inward read is auto and runs without approval', () => {
  const d = evaluateAutonomousReceipt(receipt({ capability: 'workspace_read' }));
  assert.equal(d.tier, 'auto');
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, false);
});

test('outward action is gated by default', () => {
  const d = evaluateAutonomousReceipt(receipt({ capability: 'network', approval: 'required' }));
  assert.equal(d.tier, 'gated');
  assert.equal(d.allowed, false);
  assert.equal(d.requiresApproval, true);
});

test('outward action becomes standing when pre-authorized', () => {
  const policy = resolveOutwardPolicy({ HELMR_STANDING_OUTWARD: 'network,browser' });
  const d = evaluateAutonomousReceipt(receipt({ capability: 'network', approval: 'required' }), policy);
  assert.equal(d.tier, 'standing');
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, false);
});

test('an explicitly approved outward action runs as standing', () => {
  const d = evaluateAutonomousReceipt(receipt({ capability: 'browser', approval: 'approved' }));
  assert.equal(d.tier, 'standing');
  assert.equal(d.allowed, true);
});

test('inward approval-gated write is gated until approved', () => {
  const pending = evaluateAutonomousReceipt(receipt({ capability: 'workspace_write', approval: 'required' }));
  assert.equal(pending.tier, 'gated');
  assert.equal(pending.allowed, false);

  const approved = evaluateAutonomousReceipt(receipt({ capability: 'workspace_write', approval: 'approved' }));
  assert.equal(approved.tier, 'gated');
  assert.equal(approved.allowed, true);
});

test('resolveOutwardPolicy is empty by default (everything outward is gated)', () => {
  assert.equal(resolveOutwardPolicy({}).standing.size, 0);
});
