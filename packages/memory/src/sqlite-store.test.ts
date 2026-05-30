import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { HelmrSQLiteStore } from './sqlite-store.js';

test('store init records the current schema version for migrations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-store-'));
  let store: HelmrSQLiteStore | undefined;
  try {
    store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();

    assert.equal(await store.getSchemaVersion(), 1);
  } finally {
    (store as unknown as { db?: { close: () => void } } | undefined)?.db?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('job status updates clear stale leases for non-running states', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-store-'));
  let store: HelmrSQLiteStore | undefined;
  try {
    store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    await store.upsertJob({
      id: 'job_1',
      eventId: 'evt_1',
      workspaceId: 'default',
      status: 'running',
      lane: 'interactive',
      priority: 50,
      attempts: 1,
      maxAttempts: 3,
      createdAt: '2026-05-28T10:00:00.000Z',
      updatedAt: '2026-05-28T10:00:01.000Z',
      leaseUntil: '2026-05-28T10:01:01.000Z',
    });

    await store.updateJobStatus('job_1', 'succeeded');

    const job = await store.getJob('job_1');
    assert.equal(job?.status, 'succeeded');
    assert.equal(job?.leaseUntil, undefined);
  } finally {
    (store as unknown as { db?: { close: () => void } } | undefined)?.db?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
