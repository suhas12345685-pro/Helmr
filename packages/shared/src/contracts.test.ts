import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HelmrEventSchema,
  HelmrJobSchema,
  HelmrPlanSchema,
  ToolReceiptSchema,
  isCapability,
} from './contracts.js';

const createdAt = '2026-05-28T10:00:00.000Z';

test('valid HelmrEvent parses and unknown capabilities fail', () => {
  const event = HelmrEventSchema.parse({
    id: 'evt_1',
    createdAt,
    source: 'cli',
    principal: { id: 'local', type: 'local-user', trustLevel: 'owner' },
    workspace: { id: 'default', path: 'C:/Users/DELL/Helmr' },
    payload: {
      text: 'summarize this workspace',
    },
    requestedCapabilities: ['workspace_read', 'shell_read'],
  });

  assert.equal(event.payload.text, 'summarize this workspace');
  assert.equal(isCapability('workspace_write'), true);
  assert.equal(isCapability('root_access'), false);
  assert.throws(() =>
    HelmrEventSchema.parse({
      ...event,
      requestedCapabilities: ['root_access'],
    }),
  );
});

test('HelmrJob enforces lease and retry invariants', () => {
  assert.throws(() =>
    HelmrJobSchema.parse({
      id: 'job_1',
      eventId: 'evt_1',
      workspaceId: 'default',
      status: 'leased',
      lane: 'interactive',
      priority: 10,
      attempts: 1,
      maxAttempts: 3,
      createdAt,
      updatedAt: createdAt,
    }),
  );

  assert.throws(() =>
    HelmrJobSchema.parse({
      id: 'job_1',
      eventId: 'evt_1',
      workspaceId: 'default',
      status: 'leased',
      lane: 'interactive',
      priority: 10,
      attempts: 1,
      maxAttempts: 3,
      createdAt,
      updatedAt: createdAt,
      leaseUntil: '2026-05-28T10:05:00.000Z',
    }),
  );

  assert.throws(() =>
    HelmrJobSchema.parse({
      id: 'job_1',
      eventId: 'evt_1',
      workspaceId: 'default',
      status: 'queued',
      lane: 'interactive',
      priority: 10,
      attempts: 4,
      maxAttempts: 3,
      createdAt,
      updatedAt: createdAt,
    }),
  );
});

test('unsafe HelmrPlan cannot be low risk without approval', () => {
  assert.throws(() =>
    HelmrPlanSchema.parse({
      id: 'plan_1',
      jobId: 'job_1',
      summary: 'install dependencies',
      risk: 'low',
      requiresApproval: false,
      steps: [
        {
          id: 'step_1',
          title: 'install package',
          kind: 'command',
          agent: 'coding',
          canRunInParallelWith: [],
          requiredCapabilities: ['package_install'],
        },
      ],
    }),
  );
});

test('ToolReceipt requires approval for gated capabilities', () => {
  assert.throws(() =>
    ToolReceiptSchema.parse({
      id: 'receipt_1',
      jobId: 'job_1',
      stepId: 'step_1',
      tool: 'shell',
      capability: 'workspace_write',
      input: { command: 'write' },
      risk: 'high',
      approval: 'not_required',
      createdAt,
    }),
  );
});
