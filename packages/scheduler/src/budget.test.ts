import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BudgetLedger, resolveBudgetLimits, type BudgetLimits } from './budget.js';

const UNLIMITED: BudgetLimits = { usdPerJob: 0, actionsPerJob: 0, jobSeconds: 0, toolRatePerMin: 0 };

async function ledger(limits: Partial<BudgetLimits>): Promise<BudgetLedger> {
  return BudgetLedger.create({ url: ':memory:', limits: { ...UNLIMITED, ...limits } });
}

test('resolveBudgetLimits reads env and falls back to defaults', () => {
  const limits = resolveBudgetLimits({ HELMR_BUDGET_USD_PER_JOB: '5', HELMR_MAX_ACTIONS_PER_JOB: '10' });
  assert.equal(limits.usdPerJob, 5);
  assert.equal(limits.actionsPerJob, 10);
  assert.equal(limits.jobSeconds, 1800);
});

test('action cap trips after the limit is reached', async () => {
  const led = await ledger({ actionsPerJob: 2 });
  try {
    assert.equal((await led.check('job1')).allowed, true);
    await led.recordAction('job1');
    assert.equal((await led.check('job1')).allowed, true);
    await led.recordAction('job1');
    const trip = await led.check('job1');
    assert.equal(trip.allowed, false);
    assert.equal(trip.trippedLimit, 'actions');
  } finally {
    led.close();
  }
});

test('spend cap trips when projected USD exceeds the limit', async () => {
  const led = await ledger({ usdPerJob: 1 });
  try {
    await led.recordAction('job1', { usd: 0.6 });
    assert.equal((await led.check('job1', { usd: 0.3 })).allowed, true);
    const trip = await led.check('job1', { usd: 0.5 });
    assert.equal(trip.allowed, false);
    assert.equal(trip.trippedLimit, 'usd');
  } finally {
    led.close();
  }
});

test('time cap trips once the job has run past the window', async () => {
  const led = await ledger({ jobSeconds: 10 });
  try {
    const start = new Date('2026-06-01T00:00:00.000Z');
    await led.recordAction('job1', {}, start);
    const within = await led.check('job1', {}, new Date(start.getTime() + 5_000));
    assert.equal(within.allowed, true);
    const past = await led.check('job1', {}, new Date(start.getTime() + 20_000));
    assert.equal(past.allowed, false);
    assert.equal(past.trippedLimit, 'time');
  } finally {
    led.close();
  }
});

test('rate cap trips when too many actions land within a minute', async () => {
  const led = await ledger({ toolRatePerMin: 3 });
  try {
    const t = new Date('2026-06-01T00:00:00.000Z');
    for (let i = 0; i < 3; i++) await led.recordAction('job1', {}, new Date(t.getTime() + i * 100));
    const trip = await led.check('job1', {}, new Date(t.getTime() + 400));
    assert.equal(trip.allowed, false);
    assert.equal(trip.trippedLimit, 'rate');
    // After the 60s window slides past, the rate frees up again.
    const later = await led.check('job1', {}, new Date(t.getTime() + 61_000));
    assert.equal(later.allowed, true);
  } finally {
    led.close();
  }
});

test('usage accumulates and reset clears it', async () => {
  const led = await ledger({});
  try {
    await led.recordAction('job1', { usd: 0.1, tokens: 100 });
    await led.recordAction('job1', { usd: 0.2, tokens: 50 });
    const usage = await led.usage('job1');
    assert.ok(usage);
    assert.equal(usage?.actions, 2);
    assert.ok(Math.abs((usage?.usd ?? 0) - 0.3) < 1e-9);
    assert.equal(usage?.tokens, 150);
    await led.reset('job1');
    assert.equal(await led.usage('job1'), null);
  } finally {
    led.close();
  }
});
