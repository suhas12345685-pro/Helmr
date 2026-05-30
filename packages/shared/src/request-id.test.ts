import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeRequestId } from './request-id.js';

test('request id uses a safe incoming id when present', () => {
  assert.equal(normalizeRequestId('req_123-abc'), 'req_123-abc');
});

test('request id rejects unsafe incoming ids and generates a safe fallback', () => {
  const generated = normalizeRequestId('../../secret');

  assert.match(generated, /^req_[a-f0-9-]{36}$/);
});

test('request id generates a safe fallback when missing', () => {
  const generated = normalizeRequestId(undefined);

  assert.match(generated, /^req_[a-f0-9-]{36}$/);
});
