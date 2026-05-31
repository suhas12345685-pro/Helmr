import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SelfHealingAgent } from '../../scheduler/src/self-healing.js';
import { createChannelHealingProbe, createChannelRemediation } from './channel-healing.js';
import type { ChannelAdapter, ChannelStatus } from './types.js';

function adapter(kind: string, status: ChannelStatus): ChannelAdapter & { status: ChannelStatus; starts: number } {
  return {
    name: kind,
    kind,
    status,
    starts: 0,
    getStatus() { return this.status; },
    getInfo() { return { name: kind, kind, status: this.status, paired: this.status === 'active' }; },
    async configure() {},
    async startPairing() { return { code: 'X', expiresAt: new Date().toISOString() }; },
    async confirmPairing() { return true; },
    markPaired() { this.status = 'active'; },
    async start() { this.starts += 1; },
    async stop() {},
  } as ChannelAdapter & { status: ChannelStatus; starts: number };
}

test('a failed channel adapter is restarted and validated active', async () => {
  const failed = adapter('irc', 'failed');
  const healthy = adapter('slack', 'active');
  const source = { getAdapters: () => [failed, healthy] };

  const agent = new SelfHealingAgent({
    probes: [createChannelHealingProbe(source)],
    remediations: [createChannelRemediation(source)],
  });

  const report = await agent.runCycle();
  assert.equal(report.detected, 1);
  assert.equal(report.healed, 1);
  assert.equal(failed.getStatus(), 'active');
  assert.equal(failed.starts, 1);
  assert.equal(healthy.starts, 0); // healthy adapter untouched
});

test('no incident is raised when every channel is healthy', async () => {
  const source = { getAdapters: () => [adapter('irc', 'active')] };
  const agent = new SelfHealingAgent({
    probes: [createChannelHealingProbe(source)],
    remediations: [createChannelRemediation(source)],
  });
  const report = await agent.runCycle();
  assert.equal(report.detected, 0);
});
