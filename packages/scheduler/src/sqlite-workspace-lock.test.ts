import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { SqliteWorkspaceLockManager } from './sqlite-workspace-lock.js';

async function newManager(): Promise<{ manager: SqliteWorkspaceLockManager; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-lock-'));
  const manager = await SqliteWorkspaceLockManager.create({ url: `file:${join(dir, 'locks.db')}` });
  return {
    manager,
    cleanup: async () => {
      manager.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

test('SqliteWorkspaceLockManager allows multiple readers and blocks writers', async () => {
  const { manager, cleanup } = await newManager();
  try {
    const r1 = await manager.tryAcquire({ workspaceId: 'w1', ownerId: 'reader-1', mode: 'read' });
    const r2 = await manager.tryAcquire({ workspaceId: 'w1', ownerId: 'reader-2', mode: 'read' });
    const w = await manager.tryAcquire({ workspaceId: 'w1', ownerId: 'writer-1', mode: 'write' });
    assert.ok(r1);
    assert.ok(r2);
    assert.equal(w, null);
    assert.equal((await manager.activeLocks('w1')).length, 2);
  } finally {
    await cleanup();
  }
});

test('SqliteWorkspaceLockManager serializes concurrent writers (only one wins)', async () => {
  const { manager, cleanup } = await newManager();
  try {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        manager.tryAcquire({ workspaceId: 'w1', ownerId: `writer-${i}`, mode: 'write' }),
      ),
    );
    const winners = attempts.filter((lock) => lock !== null);
    assert.equal(winners.length, 1, 'exactly one writer should acquire the lock');
  } finally {
    await cleanup();
  }
});

test('SqliteWorkspaceLockManager release frees the lock for a waiting writer', async () => {
  const { manager, cleanup } = await newManager();
  try {
    const reader = await manager.tryAcquire({ workspaceId: 'w1', ownerId: 'r1', mode: 'read' });
    assert.ok(reader);
    assert.equal(await manager.tryAcquire({ workspaceId: 'w1', ownerId: 'w1', mode: 'write' }), null);
    await manager.release(reader);
    const writer = await manager.tryAcquire({ workspaceId: 'w1', ownerId: 'w1', mode: 'write' });
    assert.equal(writer?.mode, 'write');
  } finally {
    await cleanup();
  }
});

test('SqliteWorkspaceLockManager expires stale locks based on ttl', async () => {
  const { manager, cleanup } = await newManager();
  try {
    const past = new Date('2026-05-28T10:00:00.000Z');
    const stale = await manager.tryAcquire({
      workspaceId: 'w1',
      ownerId: 'r1',
      mode: 'read',
      now: past,
      ttlMs: 10,
    });
    assert.ok(stale);
    const after = new Date('2026-05-28T10:00:00.020Z');
    assert.equal((await manager.activeLocks('w1', after)).length, 0);
    const writer = await manager.tryAcquire({ workspaceId: 'w1', ownerId: 'w1', mode: 'write', now: after });
    assert.equal(writer?.mode, 'write');
  } finally {
    await cleanup();
  }
});

test('SqliteWorkspaceLockManager renew extends ttl on an active lock', async () => {
  const { manager, cleanup } = await newManager();
  try {
    const start = new Date('2026-05-28T10:00:00.000Z');
    const lock = await manager.tryAcquire({
      workspaceId: 'w1',
      ownerId: 'w1',
      mode: 'write',
      now: start,
      ttlMs: 1_000,
    });
    assert.ok(lock);
    const renewedAt = new Date('2026-05-28T10:00:00.500Z');
    const renewed = await manager.renew(lock, 5_000, renewedAt);
    assert.equal(renewed.expiresAt, new Date(renewedAt.getTime() + 5_000).toISOString());
  } finally {
    await cleanup();
  }
});

test('SqliteWorkspaceLockManager state survives reopening the same DB (cross-process simulation)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-lock-'));
  const url = `file:${join(dir, 'locks.db')}`;
  try {
    const procA = await SqliteWorkspaceLockManager.create({ url });
    const acquired = await procA.tryAcquire({
      workspaceId: 'w1',
      ownerId: 'proc-a',
      mode: 'write',
      ttlMs: 60_000,
    });
    assert.ok(acquired);
    procA.close();

    // A second "process" opening the same DB should see the existing lock
    // and be unable to acquire a conflicting one.
    const procB = await SqliteWorkspaceLockManager.create({ url });
    const denied = await procB.tryAcquire({ workspaceId: 'w1', ownerId: 'proc-b', mode: 'write' });
    assert.equal(denied, null);
    procB.close();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
