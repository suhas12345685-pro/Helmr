import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryJobQueue } from './queue.js';

test('job queue claims queued work and completes it', () => {
  const queue = new InMemoryJobQueue();
  queue.enqueue({
    id: 'job_1',
    eventId: 'evt_1',
    workspaceId: 'default',
    status: 'queued',
    lane: 'interactive',
    priority: 50,
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2026-05-28T10:00:00.000Z',
    updatedAt: '2026-05-28T10:00:00.000Z',
  });

  const claimed = queue.claimNext({ leaseMs: 1000, now: new Date('2026-05-28T10:00:01.000Z') });
  assert.equal(claimed?.status, 'leased');
  assert.equal(claimed?.attempts, 1);

  queue.markRunning('job_1', new Date('2026-05-28T10:00:01.500Z'));
  queue.complete('job_1', new Date('2026-05-28T10:00:01.750Z'));
  assert.equal(queue.get('job_1')?.status, 'succeeded');
});

test('queue refuses retry beyond max attempts', () => {
  const queue = new InMemoryJobQueue();
  queue.enqueue({
    id: 'job_1',
    eventId: 'evt_1',
    workspaceId: 'default',
    status: 'queued',
    lane: 'interactive',
    priority: 50,
    attempts: 1,
    maxAttempts: 1,
    createdAt: '2026-05-28T10:00:00.000Z',
    updatedAt: '2026-05-28T10:00:00.000Z',
  });

  assert.equal(queue.claimNext({ leaseMs: 1000 })?.status, 'failed');
});

test('failed running jobs requeue until retry attempts are exhausted', () => {
  const queue = new InMemoryJobQueue();
  queue.enqueue({
    id: 'job_1',
    eventId: 'evt_1',
    workspaceId: 'default',
    status: 'queued',
    lane: 'interactive',
    priority: 50,
    attempts: 0,
    maxAttempts: 2,
    createdAt: '2026-05-28T10:00:00.000Z',
    updatedAt: '2026-05-28T10:00:00.000Z',
  });

  queue.claimNext({ leaseMs: 1000, now: new Date('2026-05-28T10:00:01.000Z') });
  queue.markRunning('job_1', new Date('2026-05-28T10:00:01.500Z'));

  const retryable = queue.fail('job_1', 'tool timeout', new Date('2026-05-28T10:00:03.000Z'));
  assert.equal(retryable.status, 'queued');
  assert.equal(retryable.lastError, 'tool timeout');
  assert.equal(retryable.leaseUntil, undefined);

  queue.claimNext({ leaseMs: 1000, now: new Date('2026-05-28T10:00:04.000Z') });
  queue.markRunning('job_1', new Date('2026-05-28T10:00:04.500Z'));

  const exhausted = queue.fail('job_1', 'still failing', new Date('2026-05-28T10:00:06.000Z'));
  assert.equal(exhausted.status, 'failed');
  assert.equal(exhausted.lastError, 'still failing');
});

test('expired leases are claimable again', () => {
  const queue = new InMemoryJobQueue();
  queue.enqueue({
    id: 'job_1',
    eventId: 'evt_1',
    workspaceId: 'default',
    status: 'queued',
    lane: 'interactive',
    priority: 50,
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2026-05-28T10:00:00.000Z',
    updatedAt: '2026-05-28T10:00:00.000Z',
  });

  const firstClaim = queue.claimNext({
    leaseMs: 1000,
    now: new Date('2026-05-28T10:00:01.000Z'),
  });
  assert.equal(firstClaim?.status, 'leased');
  assert.equal(firstClaim?.leaseUntil, '2026-05-28T10:00:02.000Z');

  const reclaimed = queue.claimNext({
    leaseMs: 1000,
    now: new Date('2026-05-28T10:00:03.000Z'),
  });

  assert.equal(reclaimed?.id, 'job_1');
  assert.equal(reclaimed?.status, 'leased');
  assert.equal(reclaimed?.attempts, 2);
  assert.equal(reclaimed?.leaseUntil, '2026-05-28T10:00:04.000Z');
});

test('heartbeat extends active leases and rejects expired leases', async () => {
  const queue = new InMemoryJobQueue();
  queue.enqueue({
    id: 'job_heartbeat',
    eventId: 'evt_1',
    workspaceId: 'default',
    status: 'queued',
    lane: 'interactive',
    priority: 50,
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2026-05-28T10:00:00.000Z',
    updatedAt: '2026-05-28T10:00:00.000Z',
  });

  queue.claimNext({ leaseMs: 1000, now: new Date('2026-05-28T10:00:01.000Z') });
  queue.markRunning('job_heartbeat', new Date('2026-05-28T10:00:01.500Z'));

  const heartbeated = queue.heartbeat('job_heartbeat', {
    leaseMs: 5000,
    now: new Date('2026-05-28T10:00:01.750Z'),
  });
  assert.equal(heartbeated.leaseUntil, '2026-05-28T10:00:06.750Z');

  await assert.rejects(
    async () => queue.heartbeat('job_heartbeat', {
      leaseMs: 5000,
      now: new Date('2026-05-28T10:00:07.000Z'),
    }),
    /cannot heartbeat expired lease/,
  );
});
