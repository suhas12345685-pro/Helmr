import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';

import { buildProductionVerificationEnv } from './verify-production.js';

test('production verification helper enables hardened self-test settings', () => {
  const env = buildProductionVerificationEnv({}, 'C:/helmr');

  assert.equal(env.HELMR_PRODUCTION, 'true');
  assert.equal(env.HELMR_API_TOKEN, '0123456789abcdef0123456789abcdef');
  assert.equal(env.HELMR_ALLOWED_ORIGINS, 'http://localhost:4000');
  assert.equal(env.HELMR_RATE_LIMIT_PER_MINUTE, '120');
  assert.equal(env.HELMR_MAX_BODY_BYTES, '1048576');
  assert.equal(env.HELMR_DATA_DIR, join('C:/helmr', '.helmr-production-check', 'data'));
  assert.equal(env.HELMR_CONFIG_DIR, join('C:/helmr', '.helmr-production-check', 'config'));
});

test('production verification helper preserves explicit hardened settings', () => {
  const env = buildProductionVerificationEnv({
    HELMR_API_TOKEN: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    HELMR_ALLOWED_ORIGINS: 'https://helmr.example.com',
    HELMR_RATE_LIMIT_PER_MINUTE: '60',
    HELMR_MAX_BODY_BYTES: '524288',
    HELMR_DATA_DIR: 'D:/helmr/data',
    HELMR_CONFIG_DIR: 'D:/helmr/config',
  }, 'C:/helmr');

  assert.equal(env.HELMR_PRODUCTION, 'true');
  assert.equal(env.HELMR_API_TOKEN, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(env.HELMR_ALLOWED_ORIGINS, 'https://helmr.example.com');
  assert.equal(env.HELMR_RATE_LIMIT_PER_MINUTE, '60');
  assert.equal(env.HELMR_MAX_BODY_BYTES, '524288');
  assert.equal(env.HELMR_DATA_DIR, 'D:/helmr/data');
  assert.equal(env.HELMR_CONFIG_DIR, 'D:/helmr/config');
});
