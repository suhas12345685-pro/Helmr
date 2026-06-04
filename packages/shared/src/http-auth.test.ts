import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateApiAuth, safeTokenEquals } from './http-auth.js';

test('API auth allows health checks without a token', () => {
  const decision = evaluateApiAuth({ configuredToken: undefined, authorizationHeader: undefined, method: 'GET', path: '/health', helmrProduction: 'true' });
  assert.equal(decision.allowed, true);
});

test('API auth allows no-token development only with explicit local override', () => {
  assert.equal(evaluateApiAuth({ configuredToken: undefined, authorizationHeader: undefined, method: 'GET', path: '/api/jobs', authMode: 'none' }).allowed, true);
  assert.equal(evaluateApiAuth({ configuredToken: undefined, authorizationHeader: undefined, method: 'GET', path: '/api/jobs' }).allowed, false);
});

test('API auth rejects production requests when token is missing', () => {
  assert.deepEqual(
    evaluateApiAuth({ configuredToken: undefined, authorizationHeader: undefined, method: 'GET', path: '/api/jobs', helmrProduction: 'true' }),
    { allowed: false, status: 503, error: 'HELMR_API_TOKEN is required when HELMR_PRODUCTION=true', authRequired: true, reason: 'HELMR_PRODUCTION=true' },
  );
});

test('API auth rejects protected requests when bearer token is missing or wrong', () => {
  assert.equal(evaluateApiAuth({ configuredToken: 'secret', authorizationHeader: undefined, method: 'GET', path: '/api/jobs' }).allowed, false);
  assert.equal(evaluateApiAuth({ configuredToken: 'secret', authorizationHeader: 'Bearer wrong', method: 'POST', path: '/api/events' }).allowed, false);
});

test('API auth accepts the configured bearer token', () => {
  assert.equal(evaluateApiAuth({ configuredToken: 'secret', authorizationHeader: 'Bearer secret', method: 'POST', path: '/api/events' }).allowed, true);
});

test('API auth keeps OPTIONS safe in production and permissive only in explicit dev mode', () => {
  assert.equal(evaluateApiAuth({ configuredToken: undefined, authorizationHeader: undefined, method: 'OPTIONS', path: '/api/jobs', helmrProduction: 'true' }).allowed, false);
  assert.equal(evaluateApiAuth({ configuredToken: undefined, authorizationHeader: undefined, method: 'OPTIONS', path: '/api/jobs', authMode: 'none' }).allowed, true);
});

test('safe token comparison rejects mismatches without throwing on length differences', () => {
  assert.equal(safeTokenEquals('secret', 'secret'), true);
  assert.equal(safeTokenEquals('secret', 'wrong'), false);
  assert.equal(safeTokenEquals('secret', 'secret-but-longer'), false);
});
