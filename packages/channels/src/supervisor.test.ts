import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChannelSupervisor } from './supervisor.js';
import { buildConfiguredAdapters, type ChannelEnv } from './adapter-factory.js';
import type { ChannelConfigView } from './channel-config.js';
import type { ChannelAdapter, ChannelStatus, EventEmitter } from './types.js';

type HelmrEvent = Parameters<EventEmitter>[0];

function fakeAdapter(kind: string, status: ChannelStatus, hooks: { onStart?: () => void; onStop?: () => void } = {}): ChannelAdapter {
  return {
    name: kind,
    kind,
    status,
    getStatus() { return this.status as ChannelStatus; },
    getInfo() { return { name: kind, kind, status: this.status as ChannelStatus, paired: this.status === 'active' }; },
    async configure() {},
    async startPairing() { return { code: 'X', expiresAt: new Date().toISOString() }; },
    async confirmPairing() { return true; },
    markPaired() { this.status = 'active'; },
    async start() { if (this.status !== 'active') throw new Error('not active'); hooks.onStart?.(); },
    async stop() { hooks.onStop?.(); },
  } as ChannelAdapter & { status: ChannelStatus };
}

function view(name: ChannelConfigView['name'], pairingState: ChannelConfigView['pairingState']): ChannelConfigView {
  return { name, label: name, status: 'active', pairingState };
}

test('supervisor starts active adapters and skips inactive ones', async () => {
  let started = 0;
  const supervisor = new ChannelSupervisor({
    enqueue: async () => {},
    loadAdapters: async () => [
      fakeAdapter('irc', 'active', { onStart: () => { started += 1; } }),
      fakeAdapter('signal', 'credentials_entered'),
    ],
  });

  const results = await supervisor.start();
  assert.equal(started, 1);
  assert.equal(results.find((r) => r.kind === 'irc')?.started, true);
  assert.equal(results.find((r) => r.kind === 'signal')?.started, false);
  assert.match(results.find((r) => r.kind === 'signal')?.reason ?? '', /skipped/);
  assert.deepEqual(supervisor.getRunning().map((c) => c.kind), ['irc']);
});

test('supervisor records adapters that throw on start without aborting the rest', async () => {
  const stopped: string[] = [];
  const boom = fakeAdapter('teams', 'active', { onStop: () => stopped.push('teams') });
  boom.start = async () => { throw new Error('connector down'); };
  const ok = fakeAdapter('irc', 'active', { onStop: () => stopped.push('irc') });

  const supervisor = new ChannelSupervisor({
    enqueue: async () => {},
    loadAdapters: async () => [boom, ok],
  });

  const results = await supervisor.start();
  assert.equal(results.find((r) => r.kind === 'teams')?.started, false);
  assert.match(results.find((r) => r.kind === 'teams')?.reason ?? '', /connector down/);
  assert.equal(results.find((r) => r.kind === 'irc')?.started, true);

  await supervisor.stop();
  assert.deepEqual(stopped.sort(), ['irc', 'teams']);
});

test('supervisor wires the shared emitter to enqueue', async () => {
  const enqueued: HelmrEvent[] = [];
  let captured: EventEmitter | undefined;
  const supervisor = new ChannelSupervisor({
    enqueue: async (event) => { enqueued.push(event); },
    loadAdapters: async (emit) => { captured = emit; return []; },
  });

  await supervisor.start();
  assert.ok(captured);
  await captured!({ principal: { id: 'irc:bob' } } as unknown as HelmrEvent);
  assert.equal(enqueued.length, 1);
});

test('factory builds only paired channels that have credentials', () => {
  const env: ChannelEnv = {
    HELMR_IRC_HOST: 'irc.example.net',
    HELMR_IRC_CHANNEL: '#helmr',
    HELMR_TELEGRAM_TOKEN: 'tok',
    // HELMR_TELEGRAM_ADMIN_ID intentionally missing
  };
  const skips: string[] = [];

  const adapters = buildConfiguredAdapters({
    views: [
      view('irc', 'paired'),
      view('telegram', 'paired'),
      view('signal', 'paired'),
      view('discord', 'unpaired'),
      view('webchat', 'paired'),
    ],
    env,
    emit: async () => {},
    log: (m) => skips.push(m),
  });

  assert.deepEqual(adapters.map((a) => a.kind), ['irc']);
  assert.equal(adapters[0]?.getStatus(), 'active');
  assert.ok(skips.some((m) => /telegram paired but missing credentials/.test(m)));
  assert.ok(skips.some((m) => /signal paired but missing credentials/.test(m)));
});

test('factory ignores unpaired channels even with credentials present', () => {
  const adapters = buildConfiguredAdapters({
    views: [view('irc', 'unpaired')],
    env: { HELMR_IRC_HOST: 'irc.example.net', HELMR_IRC_CHANNEL: '#helmr' },
    emit: async () => {},
  });
  assert.deepEqual(adapters, []);
});
