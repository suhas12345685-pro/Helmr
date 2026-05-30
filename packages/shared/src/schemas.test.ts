import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CapabilitySchema,
  HelmrEventSchema,
  HelmrJobSchema,
  HelmrPlanSchema,
  PlanStepSchema,
  ToolReceiptSchema,
} from './schemas.js';

const createdAt = '2026-05-28T10:30:00.000Z';

describe('Helmr contract schemas', () => {
  test('accepts a valid HelmrEvent contract', () => {
    const event = HelmrEventSchema.parse({
      id: 'event-1',
      createdAt,
      source: 'cli',
      principal: {
        id: 'principal-1',
        type: 'local-user',
        trustLevel: 'owner',
      },
      workspace: {
        id: 'workspace-1',
        path: 'C:\\Users\\DELL\\Helmr',
      },
      payload: {
        text: 'Build the shared contracts',
        attachments: [
          {
            name: 'architecture.md',
            uri: 'file:///C:/Users/DELL/Helmr/architecture.md',
            kind: 'text/markdown',
          },
        ],
      },
      requestedCapabilities: ['workspace_read', 'workspace_write'],
    });

    assert.equal(event.source, 'cli');
    assert.deepEqual(event.requestedCapabilities, ['workspace_read', 'workspace_write']);
  });

  test('rejects a HelmrEvent with an unknown source', () => {
    const result = HelmrEventSchema.safeParse({
      id: 'event-1',
      createdAt,
      source: 'email',
      principal: {
        id: 'principal-1',
        type: 'local-user',
        trustLevel: 'owner',
      },
      workspace: {
        id: 'workspace-1',
        path: 'C:\\Users\\DELL\\Helmr',
      },
      payload: {
        text: 'Build the shared contracts',
      },
      requestedCapabilities: ['workspace_read'],
    });

    assert.equal(result.success, false);
  });

  test('accepts HelmrJob lifecycle fields', () => {
    const job = HelmrJobSchema.parse({
      id: 'job-1',
      eventId: 'event-1',
      workspaceId: 'workspace-1',
      status: 'awaiting_approval',
      lane: 'interactive',
      priority: 10,
      attempts: 1,
      maxAttempts: 3,
      createdAt,
      updatedAt: createdAt,
      leaseUntil: '2026-05-28T10:35:00.000Z',
    });

    assert.equal(job.status, 'awaiting_approval');
    assert.equal(job.maxAttempts, 3);
  });

  test('accepts HelmrPlan with plan steps and capabilities', () => {
    const step = PlanStepSchema.parse({
      id: 'step-1',
      title: 'Read architecture',
      kind: 'read',
      agent: 'coding',
      canRunInParallelWith: ['step-2'],
      requiredCapabilities: ['workspace_read'],
    });

    const plan = HelmrPlanSchema.parse({
      id: 'plan-1',
      jobId: 'job-1',
      summary: 'Create shared Zod contracts',
      risk: 'medium',
      requiresApproval: false,
      steps: [step],
    });

    assert.equal(plan.steps[0]?.kind, 'read');
    assert.deepEqual(plan.steps[0]?.requiredCapabilities, ['workspace_read']);
  });

  test('accepts ToolReceipt risk and approval states', () => {
    const receipt = ToolReceiptSchema.parse({
      id: 'receipt-1',
      jobId: 'job-1',
      stepId: 'step-1',
      tool: 'shell_command',
      capability: 'shell_read',
      input: {
        command: 'npm run typecheck',
      },
      risk: 'low',
      approval: 'not_required',
      createdAt,
    });

    assert.equal(receipt.approval, 'not_required');
    assert.deepEqual(receipt.input, { command: 'npm run typecheck' });
  });

  test('rejects unknown capabilities', () => {
    assert.equal(CapabilitySchema.safeParse('database_admin').success, false);
  });
});
