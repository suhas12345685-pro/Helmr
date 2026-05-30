import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFixedWindowRateLimiter } from './rate-limit.js';

test('fixed-window limiter allows requests up to the limit', () => {
  const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 1000, now: () => 0 });

  assert.deepEqual(limiter.check('client-a'), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check('client-a'), { allowed: true, remaining: 0, retryAfterSeconds: 0 });
});

test('fixed-window limiter rejects requests beyond the limit', () => {
  const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => 100 });

  assert.equal(limiter.check('client-a').allowed, true);
  assert.deepEqual(limiter.check('client-a'), { allowed: false, remaining: 0, retryAfterSeconds: 1 });
});

test('fixed-window limiter resets after the window', () => {
  let currentTime = 0;
  const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => currentTime });

  assert.equal(limiter.check('client-a').allowed, true);
  assert.equal(limiter.check('client-a').allowed, false);

  currentTime = 1001;
  assert.deepEqual(limiter.check('client-a'), { allowed: true, remaining: 0, retryAfterSeconds: 0 });
});
