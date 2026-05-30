import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { HelmrSQLiteStore } from '../../memory/src/sqlite-store.js';
import { ModelRouter } from '../../router/src/model-router.js';
import { DEFAULT_ROUTING } from '../../router/src/routing-config.js';
import { createGatewayApp } from './http-server.js';

test('gateway keeps health public while token-protecting API routes', async () => {
  const previousToken = process.env['HELMR_API_TOKEN'];
  process.env['HELMR_API_TOKEN'] = 'secret';
  const dir = await mkdtemp(join(tmpdir(), 'helmr-gateway-test-'));
  try {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    const app = createGatewayApp(store, new ModelRouter(DEFAULT_ROUTING));

    const health = await app.request('/health');
    assert.equal(health.status, 200);

    const denied = await app.request('/api/jobs', {
      headers: { 'x-forwarded-for': 'gateway-auth-test-denied' },
    });
    assert.equal(denied.status, 401);

    const allowed = await app.request('/api/jobs', {
      headers: {
        authorization: 'Bearer secret',
        'x-forwarded-for': 'gateway-auth-test-allowed',
      },
    });
    assert.equal(allowed.status, 200);
  } finally {
    if (previousToken === undefined) {
      delete process.env['HELMR_API_TOKEN'];
    } else {
      process.env['HELMR_API_TOKEN'] = previousToken;
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
