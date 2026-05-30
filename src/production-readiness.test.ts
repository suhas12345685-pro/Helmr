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
      detail: 'HELMR_API_TOKEN must be at least 32 characters when HELMR_PRODUCTION=true',
    },
    {
      name: 'allowed_origins',
      passed: false,
      detail: 'HELMR_ALLOWED_ORIGINS must be explicitly set and cannot include *',
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
      detail: 'HELMR_DATA_DIR and HELMR_CONFIG_DIR must be explicit in production',
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
      detail: '2 allowed origin(s) configured',
    },
    {
      name: 'rate_limit',
      passed: true,
      detail: 'HELMR_RATE_LIMIT_PER_MINUTE=60',
    },
    {
      name: 'body_limit',
      passed: true,
      detail: 'HELMR_MAX_BODY_BYTES=524288',
    },
    {
      name: 'state_dirs',
      passed: true,
      detail: 'HELMR_DATA_DIR and HELMR_CONFIG_DIR are explicit',
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
      detail: 'HELMR_ALLOWED_ORIGINS must be explicitly set and cannot include *',
    },
    {
      name: 'rate_limit',
      passed: false,
      detail: 'HELMR_RATE_LIMIT_PER_MINUTE must be between 1 and 600',
    },
    {
      name: 'body_limit',
      passed: false,
      detail: 'HELMR_MAX_BODY_BYTES must be between 1024 and 10485760',
    },
    {
      name: 'state_dirs',
      passed: true,
      detail: 'HELMR_DATA_DIR and HELMR_CONFIG_DIR are explicit',
    },
  ]);
});
