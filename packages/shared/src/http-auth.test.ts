import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateApiAuth, safeTokenEquals } from './http-auth.js';

test('API auth allows health checks without a token', () => {
  const decision = evaluateApiAuth({
    configuredToken: 'secret',
    authorizationHeader: undefined,
    method: 'GET',
    path: '/health',
  });

  assert.equal(decision.allowed, true);
});

test('API auth allows local development when no token is configured', () => {
  const decision = evaluateApiAuth({
    configuredToken: undefined,
    authorizationHeader: undefined,
    method: 'GET',
    path: '/api/jobs',
  });

  assert.equal(decision.allowed, true);
});

test('API auth rejects protected requests when bearer token is missing or wrong', () => {
  assert.deepEqual(
    evaluateApiAuth({
      configuredToken: 'secret',
      authorizationHeader: undefined,
      method: 'GET',
      path: '/api/jobs',
    }),
    { allowed: false, status: 401, error: 'missing bearer token' },
  );

  assert.deepEqual(
    evaluateApiAuth({
      configuredToken: 'secret',
      authorizationHeader: 'Bearer wrong',
      method: 'POST',
      path: '/api/events',
    }),
    { allowed: false, status: 403, error: 'invalid bearer token' },
  );
});

test('API auth accepts the configured bearer token', () => {
  const decision = evaluateApiAuth({
    configuredToken: 'secret',
    authorizationHeader: 'Bearer secret',
    method: 'POST',
    path: '/api/events',
  });

  assert.equal(decision.allowed, true);
});

test('safe token comparison rejects mismatches without throwing on length differences', () => {
  assert.equal(safeTokenEquals('secret', 'secret'), true);
  assert.equal(safeTokenEquals('secret', 'wrong'), false);
  assert.equal(safeTokenEquals('secret', 'secret-but-longer'), false);
});
