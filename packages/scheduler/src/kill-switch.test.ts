import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KillSwitch, KillSwitchEngagedError, GLOBAL_SCOPE, type ControlFlagStore } from './kill-switch.js';

/** In-memory control-flag store for unit tests. */
class FakeFlagStore implements ControlFlagStore {
  readonly flags = new Map<string, { halted: boolean; reason?: string; updatedAt: string }>();
  reads = 0;
  async setControlFlag(scope: string, halted: boolean, reason?: string): Promise<void> {
    this.flags.set(scope, { halted, reason, updatedAt: new Date().toISOString() });
  }
  async getControlFlag(scope: string): Promise<{ halted: boolean; reason?: string; updatedAt: string } | undefined> {
    this.reads += 1;
    return this.flags.get(scope);
  }
  async listControlFlags(): Promise<Array<{ scope: string; halted: boolean; reason?: string; updatedAt: string }>> {
    return [...this.flags.entries()].map(([scope, v]) => ({ scope, ...v }));
  }
}

test('defaults to not halted', async () => {
  const ks = new KillSwitch({ store: new FakeFlagStore() });
  assert.equal(await ks.isHalted(), false);
});

test('halt/resume toggles the global switch durably', async () => {
  const store = new FakeFlagStore();
  const ks = new KillSwitch({ store, cacheTtlMs: 0 });
  await ks.halt(GLOBAL_SCOPE, 'maintenance');
  assert.equal(await ks.isHalted(), true);
  assert.equal((await ks.state()).reason, 'maintenance');
  // A fresh switch over the same store still sees the halt (durable).
  const reopened = new KillSwitch({ store, cacheTtlMs: 0 });
  assert.equal(await reopened.isHalted(), true);
  await ks.resume();
  assert.equal(await ks.isHalted(), false);
});

test('global halt dominates a per-agent check', async () => {
  const ks = new KillSwitch({ store: new FakeFlagStore(), cacheTtlMs: 0 });
  await ks.halt(GLOBAL_SCOPE);
  assert.equal(await ks.isHalted('agent-1'), true, 'global halt should stop every agent');
});

test('per-agent halt does not affect other agents or global', async () => {
  const ks = new KillSwitch({ store: new FakeFlagStore(), cacheTtlMs: 0 });
  await ks.halt('agent-1', 'misbehaving');
  assert.equal(await ks.isHalted('agent-1'), true);
  assert.equal(await ks.isHalted('agent-2'), false);
  assert.equal(await ks.isHalted(), false);
});

test('cache avoids a DB read on every hot-path check', async () => {
  const store = new FakeFlagStore();
  const ks = new KillSwitch({ store, cacheTtlMs: 10_000 });
  await ks.isHalted();
  await ks.isHalted();
  await ks.isHalted();
  assert.equal(store.reads, 1, 'subsequent checks within the TTL should hit the cache');
});

test('listHalted reports only engaged scopes', async () => {
  const ks = new KillSwitch({ store: new FakeFlagStore(), cacheTtlMs: 0 });
  await ks.halt('agent-1', 'r1');
  await ks.halt(GLOBAL_SCOPE);
  await ks.halt('agent-2');
  await ks.resume('agent-2');
  const engaged = (await ks.listHalted()).map((f) => f.scope).sort();
  assert.deepEqual(engaged, ['agent-1', 'global']);
});

test('KillSwitchEngagedError carries the scope', () => {
  const err = new KillSwitchEngagedError({ halted: true, scope: 'agent-9', reason: 'x' });
  assert.equal(err.scope, 'agent-9');
  assert.match(err.message, /agent-9/);
});
