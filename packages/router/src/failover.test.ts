import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runWithFailover, FailoverError, isTransientError } from './failover.js';

const noSleep = async (): Promise<void> => undefined;

test('returns the first successful attempt without trying later ones', async () => {
  const calls: string[] = [];
  const result = await runWithFailover(
    [
      { label: 'a', run: async () => { calls.push('a'); return 'from-a'; } },
      { label: 'b', run: async () => { calls.push('b'); return 'from-b'; } },
    ],
    { sleep: noSleep },
  );
  assert.equal(result, 'from-a');
  assert.deepEqual(calls, ['a']);
});

test('fails over to the next attempt when the first exhausts its retries', async () => {
  const calls: string[] = [];
  const result = await runWithFailover(
    [
      {
        label: 'primary',
        run: async () => {
          calls.push('primary');
          throw new Error('timed out');
        },
      },
      { label: 'fallback', run: async () => { calls.push('fallback'); return 'ok'; } },
    ],
    { retriesPerAttempt: 1, sleep: noSleep },
  );
  assert.equal(result, 'ok');
  // primary tried twice (1 + 1 retry), then fallback once.
  assert.deepEqual(calls, ['primary', 'primary', 'fallback']);
});

test('does not retry a non-transient error within an attempt', async () => {
  let primaryCalls = 0;
  const result = await runWithFailover(
    [
      {
        label: 'primary',
        run: async () => {
          primaryCalls += 1;
          throw new Error('400 bad request: invalid schema');
        },
      },
      { label: 'fallback', run: async () => 'ok' },
    ],
    { retriesPerAttempt: 3, sleep: noSleep },
  );
  assert.equal(result, 'ok');
  assert.equal(primaryCalls, 1, 'non-transient error should not be retried in-attempt');
});

test('throws FailoverError aggregating all failures when every attempt fails', async () => {
  await assert.rejects(
    () =>
      runWithFailover(
        [
          { label: 'a', run: async () => { throw new Error('429 rate limit'); } },
          { label: 'b', run: async () => { throw new Error('503 unavailable'); } },
        ],
        { retriesPerAttempt: 0, sleep: noSleep },
      ),
    (err: unknown) => {
      assert.ok(err instanceof FailoverError);
      assert.equal(err.attempts.length, 2);
      assert.match(err.message, /a: 429 rate limit/);
      assert.match(err.message, /b: 503 unavailable/);
      return true;
    },
  );
});

test('per-attempt timeout aborts a hung attempt and fails over', async () => {
  const result = await runWithFailover(
    [
      {
        label: 'hung',
        run: (signal) =>
          new Promise<string>((_, reject) => {
            // Never resolves on its own; the timeout should abort it.
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      },
      { label: 'fast', run: async () => 'recovered' },
    ],
    { timeoutMs: 20, retriesPerAttempt: 0, sleep: noSleep },
  );
  assert.equal(result, 'recovered');
});

test('isTransientError classifies network/rate/5xx as retryable and 4xx as not', () => {
  assert.equal(isTransientError(new Error('socket hang up')), true);
  assert.equal(isTransientError(new Error('429 Too Many Requests')), true);
  assert.equal(isTransientError(new Error('503 Service Unavailable')), true);
  assert.equal(isTransientError(new Error('overloaded_error')), true);
  assert.equal(isTransientError(new Error('invalid request: bad schema')), false);
  assert.equal(isTransientError({ status: 500 }), true);
  assert.equal(isTransientError({ status: 401 }), false);
});

test('onError fires for every failed try', async () => {
  const seen: Array<{ label: string; retry: number }> = [];
  await runWithFailover(
    [{ label: 'x', run: async () => { throw new Error('timeout'); } }],
    {
      retriesPerAttempt: 2,
      sleep: noSleep,
      onError: ({ label, retry }) => seen.push({ label, retry }),
    },
  ).catch(() => undefined);
  assert.deepEqual(seen, [
    { label: 'x', retry: 0 },
    { label: 'x', retry: 1 },
    { label: 'x', retry: 2 },
  ]);
});
