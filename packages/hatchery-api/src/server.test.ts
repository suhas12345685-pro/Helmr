import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ConfigFileManager } from '../../config/src/config-files.js';
import { HelmrSQLiteStore } from '../../memory/src/sqlite-store.js';
import { ModelRouter } from '../../router/src/model-router.js';
import { DEFAULT_ROUTING } from '../../router/src/routing-config.js';
import { createHatcheryApp } from './server.js';

async function makeApp(dir: string) {
  const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
  await store.init();
  const config = new ConfigFileManager(join(dir, 'config'));
  await config.init();
  const app = createHatcheryApp({
    store,
    router: new ModelRouter(DEFAULT_ROUTING),
    configManager: config,
    dataDir: dir,
  });
  return { app, store };
}

test('provider configure persists credentials to the secret store and reports configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-hatchery-test-'));
  try {
    const { app } = await makeApp(dir);

    const save = await app.request('/api/providers/anthropic/configure', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'sk-test-anthropic' }),
    });
    assert.equal(save.status, 200);
    const saveBody = (await save.json()) as { configured: boolean };
    assert.equal(saveBody.configured, true);

    delete process.env['ANTHROPIC_API_KEY'];

    const { app: app2 } = await makeApp(dir);
    const list = await app2.request('/api/providers');
    const listBody = (await list.json()) as { providers: Array<{ name: string; status: string; configured: boolean }> };
    const anthropic = listBody.providers.find((p) => p.name === 'anthropic');
    assert.equal(anthropic?.configured, true);
  } finally {
    delete process.env['ANTHROPIC_API_KEY'];
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('channel pairing flow generates a code, persists pending state, and completes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-hatchery-test-'));
  try {
    const { app, store } = await makeApp(dir);

    await app.request('/api/channels/telegram/configure', {
      method: 'POST',
      body: JSON.stringify({ botToken: 'super-secret-bot-token', botUsername: 'helmr_bot' }),
    });

    const start = await app.request('/api/channels/telegram/start-pairing', {
      method: 'POST',
      body: JSON.stringify({ adminId: 'tg_user_42' }),
    });
    assert.equal(start.status, 200);
    const pairing = (await start.json()) as { code: string; pairingState: string };
    assert.match(pairing.code, /^[A-Z0-9]{8}$/);
    assert.equal(pairing.pairingState, 'pending');

    const pending = await store.getChannel('telegram');
    assert.equal(pending?.pairingState, 'pending');
    assert.equal(pending?.adminId, 'tg_user_42');

    const bad = await app.request('/api/channels/telegram/complete-pairing', {
      method: 'POST',
      body: JSON.stringify({ code: 'WRONGCOD' }),
    });
    assert.equal(bad.status, 400);

    const ok = await app.request('/api/channels/telegram/complete-pairing', {
      method: 'POST',
      body: JSON.stringify({ code: pairing.code }),
    });
    assert.equal(ok.status, 200);
    const okBody = (await ok.json()) as { pairingState: string; adminId: string };
    assert.equal(okBody.pairingState, 'paired');
    assert.equal(okBody.adminId, 'tg_user_42');

    const replay = await app.request('/api/channels/telegram/complete-pairing', {
      method: 'POST',
      body: JSON.stringify({ code: pairing.code }),
    });
    assert.equal(replay.status, 400);

    const finalState = await store.getChannel('telegram');
    assert.equal(finalState?.status, 'active');
    assert.equal(finalState?.pairingState, 'paired');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('onboarding completion persists workspace path and deployment profile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-hatchery-test-'));
  try {
    const { app, store } = await makeApp(dir);

    const before = await app.request('/api/onboarding/state');
    const beforeBody = (await before.json()) as { complete: boolean };
    assert.equal(beforeBody.complete, false);

    const complete = await app.request('/api/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify({ workspacePath: '/tmp/helmr-ws', deploymentProfile: 'wsl2' }),
    });
    assert.equal(complete.status, 200);
    const completeBody = (await complete.json()) as { complete: boolean; workspacePath: string; deploymentProfile: string };
    assert.equal(completeBody.complete, true);
    assert.equal(completeBody.workspacePath, '/tmp/helmr-ws');
    assert.equal(completeBody.deploymentProfile, 'wsl2');

    const stored = await store.getSystemState<{ complete: boolean }>('onboarding');
    assert.equal(stored?.complete, true);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('channel configure rejects unknown channels and routes secrets to the secret store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-hatchery-test-'));
  try {
    const { app, store } = await makeApp(dir);

    const unknown = await app.request('/api/channels/myspace/configure', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(unknown.status, 400);

    await app.request('/api/channels/discord/configure', {
      method: 'POST',
      body: JSON.stringify({ botToken: 'discord-token', guildId: 'guild_1' }),
    });
    const channel = await store.getChannel('discord');
    assert.equal(channel?.status, 'configured');
    assert.equal(channel?.pairingState, 'unpaired');
    assert.deepEqual(channel?.config, { guildId: 'guild_1' });

    const list = await app.request('/api/channels');
    const body = (await list.json()) as { channels: Array<{ name: string; status: string; requiresPairing?: boolean }> };
    const discord = body.channels.find((ch) => ch.name === 'discord');
    assert.equal(discord?.status, 'configured');
    assert.equal(discord?.requiresPairing, true);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('hatchery keeps health public while token-protecting API routes', async () => {
  const previousToken = process.env['HELMR_API_TOKEN'];
  process.env['HELMR_API_TOKEN'] = 'secret';
  const dir = await mkdtemp(join(tmpdir(), 'helmr-hatchery-test-'));
  try {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    const config = new ConfigFileManager(join(dir, 'config'));
    await config.init();
    const app = createHatcheryApp(store, new ModelRouter(DEFAULT_ROUTING), config, dir);

    const health = await app.request('/health');
    assert.equal(health.status, 200);

    const denied = await app.request('/api/status', {
      headers: { 'x-forwarded-for': 'hatchery-auth-test-denied' },
    });
    assert.equal(denied.status, 401);

    const allowed = await app.request('/api/status', {
      headers: {
        authorization: 'Bearer secret',
        'x-forwarded-for': 'hatchery-auth-test-allowed',
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
