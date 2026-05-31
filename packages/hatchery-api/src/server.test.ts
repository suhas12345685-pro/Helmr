import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ConfigFileManager } from '../../config/src/config-files.js';
import { SecretStore } from '../../config/src/secret-store.js';
import { HelmrSQLiteStore } from '../../memory/src/sqlite-store.js';
import { ModelRouter } from '../../router/src/model-router.js';
import { DEFAULT_ROUTING } from '../../router/src/routing-config.js';
import { createHatcheryApp } from './server.js';

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

test('configuring a provider persists the API key durably for restart', async () => {
  const previousKey = process.env['ANTHROPIC_API_KEY'];
  delete process.env['ANTHROPIC_API_KEY'];
  const dir = await mkdtemp(join(tmpdir(), 'helmr-provider-test-'));
  try {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    const configDir = join(dir, 'config');
    const config = new ConfigFileManager(configDir);
    await config.init();
    const app = createHatcheryApp(store, new ModelRouter(DEFAULT_ROUTING), config, dir);

    const res = await app.request('/api/providers/anthropic/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'provider-configure' },
      body: JSON.stringify({ apiKey: '  sk-live-key  ' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { name: 'anthropic', configured: true });

    // Applied to the live process immediately (trimmed)...
    assert.equal(process.env['ANTHROPIC_API_KEY'], 'sk-live-key');
    // ...and persisted to disk so a future process can restore it.
    const persisted = await new SecretStore(configDir).get('ANTHROPIC_API_KEY');
    assert.equal(persisted, 'sk-live-key');
  } finally {
    if (previousKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = previousKey;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('channels persist pairing-required configuration and activate after code verification', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-channel-test-'));
  try {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    const config = new ConfigFileManager(join(dir, 'config'));
    await config.init();
    const app = createHatcheryApp(store, new ModelRouter(DEFAULT_ROUTING), config, dir);

    const initial = await app.request('/api/channels', {
      headers: { 'x-forwarded-for': 'channel-pairing-initial' },
    });
    assert.equal(initial.status, 200);
    const initialBody = await initial.json() as { channels: Array<{ name: string; status: string; pairingState: string }> };
    assert.deepEqual(
      initialBody.channels.find((channel) => channel.name === 'telegram'),
      { name: 'telegram', label: 'Telegram', status: 'not_configured', pairingState: 'unpaired' },
    );

    const configured = await app.request('/api/channels/telegram/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'channel-pairing-configure' },
      body: JSON.stringify({ botToken: 'test-token' }),
    });
    assert.equal(configured.status, 200);
    const configuredBody = await configured.json() as {
      name: string;
      status: string;
      pairingState: string;
      pairingCode?: string;
      pairingExpiresAt?: string;
      configuredAt?: string;
    };
    assert.equal(configuredBody.name, 'telegram');
    assert.equal(configuredBody.status, 'pairing_required');
    assert.equal(configuredBody.pairingState, 'pending');
    assert.match(configuredBody.pairingCode ?? '', /^[A-Z0-9]{8}$/);
    assert.ok(configuredBody.pairingExpiresAt);

    const pending = await app.request('/api/channels', {
      headers: { 'x-forwarded-for': 'channel-pairing-pending' },
    });
    assert.equal(pending.status, 200);
    const pendingBody = await pending.json() as { channels: Array<{ name: string; status: string; pairingState: string }> };
    assert.deepEqual(
      pendingBody.channels.find((channel) => channel.name === 'telegram'),
      {
        name: 'telegram',
        label: 'Telegram',
        status: 'pairing_required',
        pairingState: 'pending',
        configuredAt: configuredBody.configuredAt,
        pairingExpiresAt: configuredBody.pairingExpiresAt,
      },
    );

    const rawConfig = await readFile(join(dir, 'channels.json'), 'utf8');
    assert.ok(!rawConfig.includes(configuredBody.pairingCode ?? ''));

    const verified = await app.request('/api/channels/telegram/pairing/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'channel-pairing-verify' },
      body: JSON.stringify({ code: configuredBody.pairingCode }),
    });
    assert.equal(verified.status, 200);
    const verifiedBody = await verified.json() as { name: string; status: string; pairingState: string; paired: boolean };
    assert.equal(verifiedBody.name, 'telegram');
    assert.equal(verifiedBody.status, 'active');
    assert.equal(verifiedBody.pairingState, 'paired');
    assert.equal(verifiedBody.paired, true);

    const final = await app.request('/api/channels', {
      headers: { 'x-forwarded-for': 'channel-pairing-final' },
    });
    assert.equal(final.status, 200);
    const finalBody = await final.json() as { channels: Array<{ name: string; status: string; pairingState: string }> };
    const telegram = finalBody.channels.find((channel) => channel.name === 'telegram');
    assert.equal(telegram?.status, 'active');
    assert.equal(telegram?.pairingState, 'paired');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('channels reject wrong pairing code without activating the channel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-channel-wrong-code-test-'));
  try {
    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();
    const config = new ConfigFileManager(join(dir, 'config'));
    await config.init();
    const app = createHatcheryApp(store, new ModelRouter(DEFAULT_ROUTING), config, dir);

    const configured = await app.request('/api/channels/slack/configure', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'wrong-code-configure' },
      body: JSON.stringify({ botToken: 'test-token' }),
    });
    assert.equal(configured.status, 200);
    const configuredBody = await configured.json() as { pairingCode?: string };
    assert.ok(configuredBody.pairingCode);

    const rejected = await app.request('/api/channels/slack/pairing/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'wrong-code-verify' },
      body: JSON.stringify({ code: 'WRONG123' }),
    });
    assert.equal(rejected.status, 400);
    const rejectedBody = await rejected.json() as { status: string; pairingState: string; paired: boolean };
    assert.equal(rejectedBody.status, 'pairing_required');
    assert.equal(rejectedBody.pairingState, 'pending');
    assert.equal(rejectedBody.paired, false);

    const channels = await app.request('/api/channels', {
      headers: { 'x-forwarded-for': 'wrong-code-list' },
    });
    assert.equal(channels.status, 200);
    const channelsBody = await channels.json() as { channels: Array<{ name: string; status: string; pairingState: string }> };
    const slack = channelsBody.channels.find((channel) => channel.name === 'slack');
    assert.equal(slack?.status, 'pairing_required');
    assert.equal(slack?.pairingState, 'pending');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
