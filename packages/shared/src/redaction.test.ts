import assert from 'node:assert/strict';
import { test } from 'node:test';

import { redactSecrets } from './redaction.js';

test('redacts known token formats, assignments, private keys, and high entropy strings', () => {
  const output = redactSecrets([
    'api_key=s' + 'k-abcdefghijklmnopqrstuvwxyz1234567890',
    'github=g' + 'hp_abcdefghijklmnopqrstuvwxyz1234567890',
    'google=A' + 'IzaSyabcdefghijklmnopqrstuvwxyz123456',
    '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----',
    'random=0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_0123456789',
  ].join('\n'));

  assert.doesNotMatch(output, /s[k]-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(output, /g[h]p_abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(output, /A[I]zaSyabcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(output, /BEGIN PRIVATE KEY/);
  assert.match(output, /\[REDACTED/);
});
