import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runJob } from './runtime.js';
import { JsonlAuditLog } from '../packages/memory/src/audit-jsonl.js';
import { HelmrSQLiteStore } from '../packages/memory/src/sqlite-store.js';
import { getHelmrPaths } from './paths.js';

// Model provider keys that, when present, switch Helmr off the local fallback.
const MODEL_ENV_KEYS = [
  'HELMR_MODEL',
  'HELMR_COUNCIL_MODEL',
  'HELMR_RESEARCH_MODEL',
  'HELMR_CODING_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
  'PERPLEXITY_API_KEY',
];

let stateDir = '';
let workspaceDir = '';
const savedEnv: Record<string, string | undefined> = {};

before(async () => {
  // Isolate Helmr state under a throwaway directory so the e2e job never
  // touches the developer's ~/.helmr data.
  stateDir = await mkdtemp(join(tmpdir(), 'helmr-e2e-'));
  workspaceDir = await mkdtemp(join(tmpdir(), 'helmr-ws-'));

  savedEnv['HELMR_DATA_DIR'] = process.env['HELMR_DATA_DIR'];
  savedEnv['HELMR_CONFIG_DIR'] = process.env['HELMR_CONFIG_DIR'];
  savedEnv['HELMR_AUDIT_DIR'] = process.env['HELMR_AUDIT_DIR'];
  process.env['HELMR_DATA_DIR'] = join(stateDir, 'data');
  process.env['HELMR_CONFIG_DIR'] = join(stateDir, 'config');
  process.env['HELMR_AUDIT_DIR'] = join(stateDir, 'data', 'audit');

  // Force the deterministic local fallback so the full lifecycle runs offline
  // (no model provider call), making the test hermetic.
  for (const key of MODEL_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  // A minimal but realistic workspace for the plan's read steps to inspect.
  await writeFile(
    join(workspaceDir, 'package.json'),
    JSON.stringify(
      { name: 'e2e-fixture', version: '0.0.1', scripts: { test: 'node --test' }, dependencies: {} },
      null,
      2,
    ),
    'utf8',
  );
  // git init so the git_read step in the local plan exercises a real repo.
  execFileSync('git', ['init', '-q'], { cwd: workspaceDir });
});

after(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
});

test('e2e: a read-only job runs end-to-end and leaves a verifiable audit trail', async () => {
  const result = await runJob({
    text: 'summarize this workspace',
    workspacePath: workspaceDir,
  });

  // 1. Runtime produced a terminal success with a typed plan.
  assert.equal(result.status, 'succeeded');
  assert.ok(result.jobId.startsWith('job_'));
  assert.ok(result.plan, 'plan should be present on success');
  assert.equal(result.plan.jobId, result.jobId);
  assert.equal(result.plan.risk, 'low');
  assert.match(result.answer, /Workspace Summary/);

  // 2. The job is durably recorded as succeeded in the SQLite control plane.
  const paths = getHelmrPaths();
  const store = new HelmrSQLiteStore(join(paths.dataDir, 'helmr.db'));
  await store.init();
  try {
    const job = await store.getJob(result.jobId);
    assert.ok(job, 'job should be persisted');
    assert.equal(job?.status, 'succeeded');

    const savedPlan = await store.getPlan(result.jobId);
    assert.ok(savedPlan, 'plan should be persisted');
  } finally {
    store.close();
  }

  // 3. The append-only audit log is hash-chain intact and covers the lifecycle.
  const audit = new JsonlAuditLog(paths.auditDir);
  const records = await audit.readJob(result.jobId);
  const kinds = records.map((r) => r.kind);
  assert.ok(kinds.includes('event'), 'audit should record the intake event');
  assert.ok(kinds.includes('plan'), 'audit should record the plan');
  assert.ok(kinds.includes('result'), 'audit should record the result');

  const verification = await audit.verifyJob(result.jobId);
  assert.equal(verification.valid, true, verification.failureReason);
  assert.equal(verification.recordsChecked, records.length);
});

test('e2e: a tampered audit record is detected by the hash-chain verifier', async () => {
  const result = await runJob({
    text: 'summarize this workspace again',
    workspacePath: workspaceDir,
  });
  assert.equal(result.status, 'succeeded');

  const paths = getHelmrPaths();
  const audit = new JsonlAuditLog(paths.auditDir);

  // Sanity: the untampered chain verifies.
  const clean = await audit.verifyJob(result.jobId);
  assert.equal(clean.valid, true, clean.failureReason);

  // Tamper with the persisted JSONL evidence and confirm detection.
  const { readFile, writeFile: write } = await import('node:fs/promises');
  const file = join(paths.auditDir, `${result.jobId}.jsonl`);
  const original = await readFile(file, 'utf8');
  const lines = original.split('\n').filter(Boolean);
  const first = JSON.parse(lines[0]!) as { data?: Record<string, unknown> };
  first.data = { ...(first.data ?? {}), tampered: true };
  lines[0] = JSON.stringify(first);
  await write(file, `${lines.join('\n')}\n`, 'utf8');

  const tampered = await audit.verifyJob(result.jobId);
  assert.equal(tampered.valid, false);
  assert.match(tampered.failureReason ?? '', /hash/);
});
