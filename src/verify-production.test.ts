import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyDeploymentEnv } from './verify-production.js';

test('deployment verification fails closed without explicit production secrets and paths', () => {
  const result = verifyDeploymentEnv({});
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes('HELMR_API_TOKEN')));
  assert.ok(result.failures.some((failure) => failure.includes('HELMR_ALLOWED_ORIGINS')));
});

test('deployment verification rejects weak tokens and wildcard origins', () => {
  const result = verifyDeploymentEnv({
    HELMR_PRODUCTION: 'true',
    HELMR_API_TOKEN: 'too-short',
    HELMR_ALLOWED_ORIGINS: '*',
    HELMR_DATA_DIR: '/var/lib/helmr/data',
    HELMR_CONFIG_DIR: '/var/lib/helmr/config',
    HELMR_AUDIT_LOG: '/var/lib/helmr/audit.log',
    HELMR_BACKUP_DIR: '/var/backups/helmr',
  });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes('at least 32')));
  assert.ok(result.failures.some((failure) => failure.includes('wildcard')));
});

test('deployment verification passes with explicit hardened settings', () => {
  const result = verifyDeploymentEnv({
    HELMR_PRODUCTION: 'true',
    HELMR_API_TOKEN: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    HELMR_ALLOWED_ORIGINS: 'https://helmr.example.com',
    HELMR_DATA_DIR: '/var/lib/helmr/data',
    HELMR_CONFIG_DIR: '/var/lib/helmr/config',
    HELMR_AUDIT_LOG: '/var/lib/helmr/audit.log',
    HELMR_BACKUP_DIR: '/var/backups/helmr',
  });
  assert.equal(result.passed, true);
});
