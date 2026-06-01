import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KillSwitch, GLOBAL_SCOPE, agentScope } from './kill-switch.js';

async function freshSwitch(): Promise<KillSwitch> {
  return KillSwitch.create({ url: ':memory:' });
}

test('not halted by default', async () => {
  const ks = await freshSwitch();
  try {
    assert.equal(await ks.isHalted(), false);
    assert.equal(await ks.isHalted(agentScope('a1')), false);
  } finally {
    ks.close();
  }
});

test('global halt and resume', async () => {
  const ks = await freshSwitch();
  try {
    await ks.halt(GLOBAL_SCOPE, 'operator pressed stop');
    assert.equal(await ks.isHalted(), true);
    assert.equal(await ks.haltReason(), 'operator pressed stop');
    await ks.resume();
    assert.equal(await ks.isHalted(), false);
  } finally {
    ks.close();
  }
});

test('global halt implies every agent scope is halted', async () => {
  const ks = await freshSwitch();
  try {
    await ks.halt();
    assert.equal(await ks.isHalted(agentScope('whoever')), true);
  } finally {
    ks.close();
  }
});

test('per-agent halt does not affect other agents or global', async () => {
  const ks = await freshSwitch();
  try {
    await ks.halt(agentScope('a1'), 'runaway loop');
    assert.equal(await ks.isHalted(agentScope('a1')), true);
    assert.equal(await ks.isHalted(agentScope('a2')), false);
    assert.equal(await ks.isHalted(GLOBAL_SCOPE), false);
    assert.equal(await ks.haltReason(agentScope('a1')), 'runaway loop');
  } finally {
    ks.close();
  }
});

test('halt is idempotent and updates the reason', async () => {
  const ks = await freshSwitch();
  try {
    await ks.halt(GLOBAL_SCOPE, 'first');
    await ks.halt(GLOBAL_SCOPE, 'second');
    assert.equal(await ks.haltReason(), 'second');
    const halts = await ks.listHalts();
    assert.equal(halts.length, 1);
  } finally {
    ks.close();
  }
});
