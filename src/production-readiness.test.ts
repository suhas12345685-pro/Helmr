import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getProductionReadinessChecks } from './production-readiness.js';

test('production readiness passes without API token outside production mode', () => {
  const checks = getProductionReadinessChecks({});

  assert.deepEqual(checks, []);
});

test('production readiness requires enterprise security settings in production mode', () => {
  const checks = getProductionReadinessChecks({ HELMR_PRODUCTION: 'true' });

  assert.deepEqual(checks, [
    {
      name: 'api_token',
      passed: false,
      detail: 'HELMR_API_TOKEN must be at least 32 chars. Found length: 0',
    },
    {
      name: 'allowed_origins',
      passed: false,
      detail: 'HELMR_ALLOWED_ORIGINS is empty or missing',
    },
    {
      name: 'rate_limit',
      passed: true,
      detail: 'HELMR_RATE_LIMIT_PER_MINUTE defaults to 120',
    },
    {
      name: 'body_limit',
      passed: true,
      detail: 'HELMR_MAX_BODY_BYTES defaults to 1048576',
    },
    {
      name: 'state_dirs',
      passed: false,
      detail: 'HELMR_DATA_DIR and HELMR_CONFIG_DIR environment variables must be non-empty paths in production',
    },
  ]);
});

test('production readiness accepts hardened production settings', () => {
  const checks = getProductionReadinessChecks({
    HELMR_PRODUCTION: 'true',
    HELMR_API_TOKEN: '0123456789abcdef0123456789abcdef',
    HELMR_ALLOWED_ORIGINS: 'https://helmr.example.com,http://localhost:4000',
    HELMR_RATE_LIMIT_PER_MINUTE: '60',
    HELMR_MAX_BODY_BYTES: '524288',
    HELMR_DATA_DIR: 'C:/helmr/data',
    HELMR_CONFIG_DIR: 'C:/helmr/config',
  });

  assert.deepEqual(checks, [
    {
      name: 'api_token',
      passed: true,
      detail: 'HELMR_API_TOKEN is set with sufficient length',
    },
    {
      name: 'allowed_origins',
      passed: true,
      detail: '2 allowed origin(s) successfully verified',
    },
    {
      name: 'rate_limit',
      passed: true,
      detail: 'HELMR_RATE_LIMIT_PER_MINUTE=60 (Verified range 1-600)',
    },
    {
      name: 'body_limit',
      passed: true,
      detail: 'HELMR_MAX_BODY_BYTES=524288 (Verified range 1024-10485760)',
    },
    {
      name: 'state_dirs',
      passed: true,
      detail: 'HELMR_DATA_DIR and HELMR_CONFIG_DIR explicitly isolated',
    },
  ]);
});

test('production readiness rejects wildcard origins and unsafe request limits', () => {
  const checks = getProductionReadinessChecks({
    HELMR_PRODUCTION: 'true',
    HELMR_API_TOKEN: '0123456789abcdef0123456789abcdef',
    HELMR_ALLOWED_ORIGINS: '*',
    HELMR_RATE_LIMIT_PER_MINUTE: '0',
    HELMR_MAX_BODY_BYTES: '999999999',
    HELMR_DATA_DIR: 'C:/helmr/data',
    HELMR_CONFIG_DIR: 'C:/helmr/config',
  });

  assert.deepEqual(checks, [
    {
      name: 'api_token',
      passed: true,
      detail: 'HELMR_API_TOKEN is set with sufficient length',
    },
    {
      name: 'allowed_origins',
      passed: false,
      detail: 'HELMR_ALLOWED_ORIGINS contains an invalid wildcard (*) character sequence',
    },
    {
      name: 'rate_limit',
      passed: false,
      detail: 'HELMR_RATE_LIMIT_PER_MINUTE=0 (Verified range 1-600)',
    },
    {
      name: 'body_limit',
      passed: false,
      detail: 'HELMR_MAX_BODY_BYTES=999999999 (Verified range 1024-10485760)',
    },
    {
      name: 'state_dirs',
      passed: true,
      detail: 'HELMR_DATA_DIR and HELMR_CONFIG_DIR explicitly isolated',
    },
  ]);
});

test('production readiness reports parse failure when integer envs are non-numeric', () => {
  const checks = getProductionReadinessChecks({
    HELMR_PRODUCTION: 'true',
    HELMR_API_TOKEN: '0123456789abcdef0123456789abcdef',
    HELMR_ALLOWED_ORIGINS: 'https://helmr.example.com',
    HELMR_RATE_LIMIT_PER_MINUTE: 'unlimited',
    HELMR_MAX_BODY_BYTES: 'huge',
    HELMR_DATA_DIR: 'C:/helmr/data',
    HELMR_CONFIG_DIR: 'C:/helmr/config',
  });

  const rateLimit = checks.find((c) => c.name === 'rate_limit');
  const bodyLimit = checks.find((c) => c.name === 'body_limit');

  assert.deepEqual(rateLimit, {
    name: 'rate_limit',
    passed: false,
    detail: 'HELMR_RATE_LIMIT_PER_MINUTE configuration parse failure: "unlimited" is not a valid base-10 integer',
  });
  assert.deepEqual(bodyLimit, {
    name: 'body_limit',
    passed: false,
    detail: 'HELMR_MAX_BODY_BYTES configuration parse failure: "huge" is not a valid byte count integer',
  });
});

test('production readiness rejects partial wildcard subdomain patterns in origins', () => {
  const checks = getProductionReadinessChecks({
    HELMR_PRODUCTION: 'true',
    HELMR_API_TOKEN: '0123456789abcdef0123456789abcdef',
    HELMR_ALLOWED_ORIGINS: 'https://helmr.ai, *.helmr.ai',
    HELMR_DATA_DIR: 'C:/helmr/data',
    HELMR_CONFIG_DIR: 'C:/helmr/config',
  });

  const origins = checks.find((c) => c.name === 'allowed_origins');
  assert.deepEqual(origins, {
    name: 'allowed_origins',
    passed: false,
    detail: 'HELMR_ALLOWED_ORIGINS contains an invalid wildcard (*) character sequence',
  });
});
