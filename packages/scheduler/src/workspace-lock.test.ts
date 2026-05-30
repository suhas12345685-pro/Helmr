import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { WorkspaceLockManager } from './workspace-lock.js';

describe('WorkspaceLockManager', () => {
  test('allows multiple readers in the same workspace', () => {
    const locks = new WorkspaceLockManager();

    const first = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'read',
    });
    const second = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-2',
      mode: 'read',
    });

    assert.equal(first?.mode, 'read');
    assert.equal(second?.mode, 'read');
    assert.equal(locks.activeLocks('workspace-1').length, 2);
  });

  test('blocks writers while readers are active', () => {
    const locks = new WorkspaceLockManager();
    const reader = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'read',
    });

    const writer = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-2',
      mode: 'write',
    });

    assert.ok(reader);
    assert.equal(writer, null);
  });

  test('blocks readers and writers while a writer is active', () => {
    const locks = new WorkspaceLockManager();
    const writer = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'write',
    });

    const reader = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-2',
      mode: 'read',
    });
    const secondWriter = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-3',
      mode: 'write',
    });

    assert.equal(writer?.mode, 'write');
    assert.equal(reader, null);
    assert.equal(secondWriter, null);
  });

  test('blocks all other locks while an exclusive lock is active', () => {
    const locks = new WorkspaceLockManager();
    const exclusive = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'exclusive',
    });

    const reader = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-2',
      mode: 'read',
    });
    const writer = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-3',
      mode: 'write',
    });
    const secondExclusive = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-4',
      mode: 'exclusive',
    });

    assert.equal(exclusive?.mode, 'exclusive');
    assert.equal(reader, null);
    assert.equal(writer, null);
    assert.equal(secondExclusive, null);
  });

  test('allows conflicting locks after the active lock is released', () => {
    const locks = new WorkspaceLockManager();
    const reader = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'read',
    });

    assert.ok(reader);
    assert.equal(
      locks.tryAcquire({
        workspaceId: 'workspace-1',
        ownerId: 'worker-2',
        mode: 'write',
      }),
      null,
    );

    locks.release(reader);
    const writer = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-2',
      mode: 'write',
    });

    assert.equal(writer?.mode, 'write');
  });

  test('releasing one duplicate owner lock keeps the remaining lock active', () => {
    const locks = new WorkspaceLockManager();
    const first = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'read',
    });
    const second = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'read',
    });

    assert.ok(first);
    assert.ok(second);

    locks.release(first);

    assert.equal(locks.activeLocks('workspace-1').length, 1);
    assert.equal(
      locks.tryAcquire({
        workspaceId: 'workspace-1',
        ownerId: 'worker-2',
        mode: 'write',
      }),
      null,
    );
  });

  test('isolates locks by workspace', () => {
    const locks = new WorkspaceLockManager();
    const firstWorkspace = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'write',
    });

    const secondWorkspace = locks.tryAcquire({
      workspaceId: 'workspace-2',
      ownerId: 'worker-2',
      mode: 'write',
    });

    assert.equal(firstWorkspace?.workspaceId, 'workspace-1');
    assert.equal(secondWorkspace?.workspaceId, 'workspace-2');
  });
});

  test('clears stale locks and allows waiting writers to acquire', async () => {
    const locks = new WorkspaceLockManager();
    const reader = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-1',
      mode: 'read',
      now: new Date('2026-05-28T10:00:00.000Z'),
      ttlMs: 10,
    });

    assert.ok(reader);
    assert.equal(locks.activeLocks('workspace-1', new Date('2026-05-28T10:00:00.020Z')).length, 0);

    const writer = locks.tryAcquire({
      workspaceId: 'workspace-1',
      ownerId: 'worker-2',
      mode: 'write',
      now: new Date('2026-05-28T10:00:00.021Z'),
    });
    assert.equal(writer?.mode, 'write');
  });
