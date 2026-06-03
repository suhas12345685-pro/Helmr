import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HelmrSQLiteStore } from '../../packages/memory/src/sqlite-store.js';
import { ModelRouter } from '../../packages/router/src/model-router.js';
import { DEFAULT_ROUTING } from '../../packages/router/src/routing-config.js';
import { createGatewayApp } from '../../packages/gateway/src/http-server.js';

test('Gateway intake queues a job with explicit development auth override', async () => {
  const old = process.env.HELMR_AUTH_MODE;
  process.env.HELMR_AUTH_MODE = 'none';
  const dir = await mkdtemp(join(tmpdir(), 'helmr-e2e-'));
  try {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    const app = createGatewayApp(store, new ModelRouter(DEFAULT_ROUTING));
    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payload: { text: 'hello' },
        workspace: { id: 'default', path: dir },
        principal: { id: 'local-owner', type: 'local-user', trustLevel: 'owner' },
      }),
    });
    assert.equal(res.status, 202);
    assert.equal((await store.listJobs({ limit: 10 })).length, 1);
  } finally {
    if (old === undefined) delete process.env.HELMR_AUTH_MODE; else process.env.HELMR_AUTH_MODE = old;
    await rm(dir, { recursive: true, force: true });
  }
});
