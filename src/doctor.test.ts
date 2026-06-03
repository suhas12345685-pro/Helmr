import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectChecks, formatReport, type CheckResult } from './doctor.js';

let stateDir = '';
const saved: Record<string, string | undefined> = {};

before(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'helmr-doctor-'));
  for (const k of ['HELMR_DATA_DIR', 'HELMR_CONFIG_DIR', 'HELMR_AUDIT_DIR', 'HELMR_BUDGET_USD_PER_DAY']) saved[k] = process.env[k];
  process.env['HELMR_DATA_DIR'] = join(stateDir, 'data');
  process.env['HELMR_CONFIG_DIR'] = join(stateDir, 'config');
  process.env['HELMR_AUDIT_DIR'] = join(stateDir, 'data', 'audit');
});

after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
});

function find(checks: CheckResult[], name: string): CheckResult {
  const c = checks.find((x) => x.name === name);
  assert.ok(c, `expected a "${name}" check`);
  return c!;
}

test('formatReport summarizes health and surfaces failures', () => {
  const healthy = formatReport([{ name: 'a', level: 'ok', detail: 'x' }]);
  assert.match(healthy, /HEALTHY/);

  const warned = formatReport([{ name: 'a', level: 'warn', detail: 'x' }]);
  assert.match(warned, /OK with 1 warning/);

  const failed = formatReport([{ name: 'a', level: 'fail', detail: 'boom' }]);
  assert.match(failed, /UNHEALTHY — 1 failure/);
});

test('collectChecks reports a healthy baseline on a fresh state dir', async () => {
  const checks = await collectChecks();
  assert.equal(find(checks, 'database').level, 'ok');
  assert.equal(find(checks, 'kill-switch').level, 'ok');
  // No budget spend recorded → ok with default cap.
  assert.equal(find(checks, 'budget').level, 'ok');
  // Fail-safe policy with no file present.
  assert.match(find(checks, 'outward-policy').detail, /fail-safe/);
});

test('collectChecks flags an exhausted daily budget as fail', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await mkdir(join(stateDir, 'data'), { recursive: true });
  await writeFile(join(stateDir, 'data', 'budget-spend.json'), JSON.stringify({ [today]: 100 }), 'utf8');
  process.env['HELMR_BUDGET_USD_PER_DAY'] = '20';
  try {
    const checks = await collectChecks();
    assert.equal(find(checks, 'budget').level, 'fail');
  } finally {
    delete process.env['HELMR_BUDGET_USD_PER_DAY'];
  }
});

test('collectChecks detects a tampered audit chain as fail', async () => {
  const auditDir = join(stateDir, 'data', 'audit');
  await mkdir(auditDir, { recursive: true });
  // A record whose stored hash will not match a recomputation → verify fails.
  const bogus = { kind: 'event', jobId: 'job_x', createdAt: new Date().toISOString(), data: {}, hash: 'deadbeef', prevHash: null };
  await writeFile(join(auditDir, 'job_x.jsonl'), `${JSON.stringify(bogus)}\n`, 'utf8');

  const checks = await collectChecks();
  assert.equal(find(checks, 'audit-chain').level, 'fail');
});
