import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getAllowedOrigins, isOriginAllowed, securityHeaders } from './http-security.js';

test('security headers include baseline browser protections', () => {
  assert.equal(securityHeaders['X-Content-Type-Options'], 'nosniff');
  assert.equal(securityHeaders['X-Frame-Options'], 'DENY');
  assert.equal(securityHeaders['Referrer-Policy'], 'no-referrer');
  assert.equal(securityHeaders['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(securityHeaders['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(securityHeaders['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.match(securityHeaders['Content-Security-Policy'] ?? '', /default-src 'self'/);
});

test('allowed origins default to local Hatchery origin', () => {
  assert.deepEqual(getAllowedOrigins(undefined), ['http://localhost:4000']);
});

test('allowed origins parse comma-separated config', () => {
  assert.deepEqual(
    getAllowedOrigins('https://helmr.example.com, http://localhost:4000 ,,'),
    ['https://helmr.example.com', 'http://localhost:4000'],
  );
});

test('origin matching only allows configured origins', () => {
  const origins = ['https://helmr.example.com'];

  assert.equal(isOriginAllowed(undefined, origins), true);
  assert.equal(isOriginAllowed('https://helmr.example.com', origins), true);
  assert.equal(isOriginAllowed('https://evil.example.com', origins), false);
});
