import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BudgetLedger, InMemoryDailySpendStore } from './budget.js';

function fixedClock(start = 0): { now: () => Date; advance: (ms: number) => void } {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
}

test('records LLM usage as USD spend per job', async () => {
  const ledger = new BudgetLedger();
  const cost = await ledger.recordLlm('job1', 'anthropic/claude-sonnet-4-5', {
    inputTokens: 1_000_000,
    outputTokens: 0,
  });
  assert.equal(cost, 3);
  const snap = ledger.snapshot('job1');
  assert.equal(snap.spendUsd, 3);
  assert.equal(snap.inputTokens, 1_000_000);
  assert.equal(snap.actions, 1);
});

test('trips the per-job USD cap', async () => {
  const ledger = new BudgetLedger({ limits: { usdPerJob: 2 } });
  await ledger.recordLlm('job1', 'anthropic/claude-sonnet-4-5', { inputTokens: 1_000_000 });
  // Spent $3 already > $2 cap.
  const check = await ledger.check('job1');
  assert.equal(check.allowed, false);
  assert.equal(check.trippedLimit, 'usd_per_job');
});

test('per-day USD cap is shared across jobs and persisted via the daily store', async () => {
  const store = new InMemoryDailySpendStore();
  const limits = { usdPerDay: 5 };
  const ledgerA = new BudgetLedger({ limits, dailyStore: store });
  await ledgerA.recordLlm('jobA', 'anthropic/claude-sonnet-4-5', { inputTokens: 1_000_000 }); // $3

  // A fresh ledger over the same store still sees the day's spend (restart-safe).
  const ledgerB = new BudgetLedger({ limits, dailyStore: store });
  await ledgerB.recordLlm('jobB', 'anthropic/claude-sonnet-4-5', { inputTokens: 1_000_000 }); // $3 -> $6 total

  const check = await ledgerB.check('jobC');
  assert.equal(check.allowed, false);
  assert.equal(check.trippedLimit, 'usd_per_day');
});

test('trips the action-count cap', async () => {
  const ledger = new BudgetLedger({ limits: { maxActionsPerJob: 2 } });
  ledger.recordAction('job1');
  ledger.recordAction('job1');
  const check = await ledger.check('job1');
  assert.equal(check.allowed, false);
  assert.equal(check.trippedLimit, 'actions_per_job');
});

test('trips the wall-clock cap', async () => {
  const clock = fixedClock();
  const ledger = new BudgetLedger({ limits: { maxJobSeconds: 10 }, now: clock.now });
  await ledger.check('job1'); // initializes startedAt at t=0
  clock.advance(11_000);
  const check = await ledger.check('job1');
  assert.equal(check.allowed, false);
  assert.equal(check.trippedLimit, 'job_seconds');
});

test('trips the sliding tool-rate cap and recovers after the window', async () => {
  const clock = fixedClock();
  const ledger = new BudgetLedger({ limits: { toolRatePerMin: 3 }, now: clock.now });
  ledger.recordAction('job1');
  ledger.recordAction('job1');
  ledger.recordAction('job1');
  assert.equal((await ledger.check('job1')).trippedLimit, 'tool_rate');

  // Advance past the 60s window; old actions age out.
  clock.advance(61_000);
  assert.equal((await ledger.check('job1')).allowed, true);
});

test('projected cost is considered before allowing a call', async () => {
  const ledger = new BudgetLedger({ limits: { usdPerJob: 1 } });
  const ok = await ledger.check('job1', 0.5);
  assert.equal(ok.allowed, true);
  const tooMuch = await ledger.check('job1', 1.5);
  assert.equal(tooMuch.allowed, false);
  assert.equal(tooMuch.trippedLimit, 'usd_per_job');
});

test('allows everything when no limits are configured', async () => {
  const ledger = new BudgetLedger();
  await ledger.recordLlm('job1', 'anthropic/claude-opus-4-7', { inputTokens: 10_000_000, outputTokens: 10_000_000 });
  assert.equal((await ledger.check('job1')).allowed, true);
});
