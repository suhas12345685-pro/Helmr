import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SharedError,
  isSharedError,
  lockConflictError,
  policyDenialError,
  toolFailureError,
  validationError,
} from './errors.js';

describe('shared typed error helpers', () => {
  it('creates validation errors with stable machine fields', () => {
    const error = validationError('Workspace name is required', {
      field: 'workspaceName',
      issues: ['required'],
    });

    assert.ok(error instanceof Error);
    assert.ok(error instanceof SharedError);
    assert.equal(error.name, 'ValidationError');
    assert.equal(error.kind, 'validation');
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.status, 400);
    assert.deepEqual(error.details, {
      field: 'workspaceName',
      issues: ['required'],
    });
  });

  it('creates policy denial errors with policy context', () => {
    const error = policyDenialError('Tool use denied by policy', {
      policy: 'no-shell-without-approval',
      reason: 'approval_missing',
      actorId: 'agent-7',
    });

    assert.equal(error.name, 'PolicyDenialError');
    assert.equal(error.kind, 'policy_denial');
    assert.equal(error.code, 'POLICY_DENIED');
    assert.equal(error.status, 403);
    assert.deepEqual(error.details, {
      policy: 'no-shell-without-approval',
      reason: 'approval_missing',
      actorId: 'agent-7',
    });
  });

  it('creates lock conflict errors with resource ownership context', () => {
    const error = lockConflictError('Task is locked by another worker', {
      resourceId: 'packages/shared/src/errors.ts',
      ownerId: 'worker-4',
      expiresAt: '2026-05-28T12:30:00.000Z',
    });

    assert.equal(error.name, 'LockConflictError');
    assert.equal(error.kind, 'lock_conflict');
    assert.equal(error.code, 'LOCK_CONFLICT');
    assert.equal(error.status, 409);
    assert.deepEqual(error.details, {
      resourceId: 'packages/shared/src/errors.ts',
      ownerId: 'worker-4',
      expiresAt: '2026-05-28T12:30:00.000Z',
    });
  });

  it('creates tool failure errors with the original cause', () => {
    const cause = new Error('spawn failed');
    const error = toolFailureError(
      'Tool execution failed',
      {
        toolName: 'npm',
        exitCode: 1,
        stderr: 'typecheck failed',
      },
      { cause },
    );

    assert.equal(error.name, 'ToolFailureError');
    assert.equal(error.kind, 'tool_failure');
    assert.equal(error.code, 'TOOL_FAILURE');
    assert.equal(error.status, 502);
    assert.equal(error.cause, cause);
    assert.deepEqual(error.details, {
      toolName: 'npm',
      exitCode: 1,
      stderr: 'typecheck failed',
    });
  });

  it('identifies and serializes shared errors safely', () => {
    const error = validationError('Invalid value', { field: 'port' });

    assert.equal(isSharedError(error), true);
    assert.equal(isSharedError(new Error('plain')), false);
    assert.deepEqual(error.toJSON(), {
      name: 'ValidationError',
      message: 'Invalid value',
      kind: 'validation',
      code: 'VALIDATION_ERROR',
      status: 400,
      details: { field: 'port' },
    });
  });
});
