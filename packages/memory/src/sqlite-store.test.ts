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

test('durable store claims queued jobs by priority and records a lease', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-store-'));
  let store: HelmrSQLiteStore | undefined;
  try {
    store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    const createdAt = '2026-05-28T10:00:00.000Z';
    await store.upsertJob({
      id: 'job_low',
      eventId: 'evt_low',
      workspaceId: 'default',
      status: 'queued',
      lane: 'interactive',
      priority: 10,
      attempts: 0,
      maxAttempts: 3,
      createdAt,
      updatedAt: createdAt,
    });
    await store.upsertJob({
      id: 'job_high',
      eventId: 'evt_high',
      workspaceId: 'default',
      status: 'queued',
      lane: 'interactive',
      priority: 90,
      attempts: 0,
      maxAttempts: 3,
      createdAt,
      updatedAt: createdAt,
    });

    const claimed = await store.claimNextJob({
      leaseMs: 60_000,
      now: new Date('2026-05-28T10:00:30.000Z'),
    });

    assert.equal(claimed?.id, 'job_high');
    assert.equal(claimed?.status, 'running');
    assert.equal(claimed?.attempts, 1);
    assert.equal(claimed?.leaseUntil, '2026-05-28T10:01:30.000Z');
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('durable store reclaims expired running jobs but skips active leases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-store-'));
  let store: HelmrSQLiteStore | undefined;
  try {
    store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    await store.upsertJob({
      id: 'job_active',
      eventId: 'evt_active',
      workspaceId: 'default',
      status: 'running',
      lane: 'interactive',
      priority: 90,
      attempts: 1,
      maxAttempts: 3,
      createdAt: '2026-05-28T10:00:00.000Z',
      updatedAt: '2026-05-28T10:00:01.000Z',
      leaseUntil: '2026-05-28T10:05:00.000Z',
    });
    await store.upsertJob({
      id: 'job_expired',
      eventId: 'evt_expired',
      workspaceId: 'default',
      status: 'running',
      lane: 'interactive',
      priority: 50,
      attempts: 1,
      maxAttempts: 3,
      createdAt: '2026-05-28T10:00:00.000Z',
      updatedAt: '2026-05-28T10:00:01.000Z',
      leaseUntil: '2026-05-28T10:00:30.000Z',
    });

    const claimed = await store.claimNextJob({
      leaseMs: 30_000,
      now: new Date('2026-05-28T10:01:00.000Z'),
    });

    assert.equal(claimed?.id, 'job_expired');
    assert.equal(claimed?.attempts, 2);
    assert.equal(claimed?.leaseUntil, '2026-05-28T10:01:30.000Z');
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
