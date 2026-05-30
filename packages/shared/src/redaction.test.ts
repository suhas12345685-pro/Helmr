import assert from 'node:assert/strict';
import { test } from 'node:test';

import { redactSecrets } from './redaction.js';

test('redacts known token formats, assignments, private keys, and high entropy strings', () => {
  const output = redactSecrets([
    'api_key=sk-abcdefghijklmnopqrstuvwxyz1234567890',
    'github=ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'google=AIzaSyabcdefghijklmnopqrstuvwxyz123456',
    '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----',
    'random=0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_0123456789',
  ].join('\n'));

  assert.doesNotMatch(output, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(output, /ghp_abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(output, /AIzaSyabcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(output, /BEGIN PRIVATE KEY/);
  assert.match(output, /\[REDACTED/);
});
