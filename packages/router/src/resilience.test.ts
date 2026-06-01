import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runWithFailover, AllRoutesFailedError } from './resilience.js';
import type { ModelRoute } from './routing-config.js';

const ROUTES: ModelRoute[] = [
  { provider: 'anthropic', model: 'claude-opus-4-7' },
  { provider: 'openai', model: 'gpt-5' },
];

const noSleep = async (): Promise<void> => undefined;

test('returns the first successful result without falling over', async () => {
  let calls = 0;
  const out = await runWithFailover(
    ROUTES,
    async (route) => {
      calls++;
      return `ok:${route.provider}`;
    },
    { sleep: noSleep },
  );
  assert.equal(out.result, 'ok:anthropic');
  assert.equal(out.route.provider, 'anthropic');
  assert.equal(calls, 1);
});

test('retries the same route before failing over', async () => {
  const attempts: string[] = [];
  const out = await runWithFailover(
    ROUTES,
    async (route, n) => {
      attempts.push(`${route.provider}#${n}`);
      if (route.provider === 'anthropic') throw new Error('timeout');
      return 'recovered';
    },
    { retriesPerRoute: 2, sleep: noSleep },
  );
  // anthropic tried 3 times (1 + 2 retries), then failed over to openai.
  assert.deepEqual(attempts, ['anthropic#1', 'anthropic#2', 'anthropic#3', 'openai#4']);
  assert.equal(out.result, 'recovered');
  assert.equal(out.route.provider, 'openai');
});

test('a non-retryable error fails over immediately without retrying', async () => {
  const attempts: string[] = [];
  const out = await runWithFailover(
    ROUTES,
    async (route) => {
      attempts.push(route.provider);
      if (route.provider === 'anthropic') throw new Error('401 unauthorized');
      return 'ok';
    },
    { retriesPerRoute: 5, isRetryable: (err) => !/401/.test(String(err)), sleep: noSleep },
  );
  assert.deepEqual(attempts, ['anthropic', 'openai']);
  assert.equal(out.result, 'ok');
});

test('throws AllRoutesFailedError when every route is exhausted', async () => {
  await assert.rejects(
    runWithFailover(
      ROUTES,
      async () => {
        throw new Error('provider down');
      },
      { retriesPerRoute: 1, sleep: noSleep },
    ),
    (err: unknown) => {
      assert.ok(err instanceof AllRoutesFailedError);
      assert.equal(err.routes.length, 2);
      assert.match(err.message, /provider down/);
      return true;
    },
  );
});

test('requires at least one route', async () => {
  await assert.rejects(runWithFailover([], async () => 'x'), /at least one route/);
});
