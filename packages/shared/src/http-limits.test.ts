import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateContentLength } from './http-limits.js';

test('content length limit allows missing or valid lengths', () => {
  assert.deepEqual(evaluateContentLength(undefined, 1024), { allowed: true });
  assert.deepEqual(evaluateContentLength('512', 1024), { allowed: true });
});

test('content length limit rejects invalid and oversized lengths', () => {
  assert.deepEqual(evaluateContentLength('abc', 1024), {
    allowed: false,
    status: 400,
    error: 'invalid content-length',
  });
  assert.deepEqual(evaluateContentLength('1025', 1024), {
    allowed: false,
    status: 413,
    error: 'request body too large',
  });
});
