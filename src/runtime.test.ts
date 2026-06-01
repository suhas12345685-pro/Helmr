import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { HelmrSQLiteStore } from '../packages/memory/src/sqlite-store.js';
import { runJob } from './runtime.js';

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
] as const;

test('runJob completes the local read-only agent loop and persists Hatchery evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-runtime-test-'));
  const workspace = join(dir, 'workspace');
  const dataDir = join(dir, 'data');
  const auditDir = join(dataDir, 'audit');
  const previousDataDir = process.env['HELMR_DATA_DIR'];
  const previousAuditDir = process.env['HELMR_AUDIT_DIR'];
  const previousModelEnv = new Map<string, string | undefined>(MODEL_ENV_KEYS.map((key) => [key, process.env[key]]));

  try {
    process.env['HELMR_DATA_DIR'] = dataDir;
    process.env['HELMR_AUDIT_DIR'] = auditDir;
    for (const key of MODEL_ENV_KEYS) delete process.env[key];

    await mkdir(workspace, { recursive: true });
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({ name: 'runtime-e2e', scripts: { typecheck: 'tsc --noEmit' } }, null, 2),
    );

    const result = await runJob({
      text: 'summarize this workspace and identify next development steps',
      workspacePath: workspace,
    });

    const store = new HelmrSQLiteStore(join(dataDir, 'helmr.db'));
    await store.init();
    const job = await store.getJob(result.jobId);
    const receipts = await store.listReceiptsForJob(result.jobId);
    store.close();

    assert.equal(result.status, 'succeeded');
    assert.match(result.answer, /Workspace Summary/);
    assert.equal(job?.finalResult, result.answer);
    assert.deepEqual(receipts.map((receipt) => receipt.tool), [
      'read_workspace',
      'read_workspace_file',
      'git_status',
    ]);
  } finally {
    if (previousDataDir === undefined) delete process.env['HELMR_DATA_DIR'];
    else process.env['HELMR_DATA_DIR'] = previousDataDir;
    if (previousAuditDir === undefined) delete process.env['HELMR_AUDIT_DIR'];
    else process.env['HELMR_AUDIT_DIR'] = previousAuditDir;
    for (const [key, value] of previousModelEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('runJob auto-routes a wide research request into a persisted swarm', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-runtime-swarm-'));
  const workspace = join(dir, 'workspace');
  const dataDir = join(dir, 'data');
  const auditDir = join(dataDir, 'audit');
  const previousDataDir = process.env['HELMR_DATA_DIR'];
  const previousAuditDir = process.env['HELMR_AUDIT_DIR'];
  const previousModelEnv = new Map<string, string | undefined>(MODEL_ENV_KEYS.map((key) => [key, process.env[key]]));

  try {
    process.env['HELMR_DATA_DIR'] = dataDir;
    process.env['HELMR_AUDIT_DIR'] = auditDir;
    for (const key of MODEL_ENV_KEYS) delete process.env[key];

    await mkdir(workspace, { recursive: true });

    const result = await runJob({
      text: 'compare Postgres, MySQL, and SQLite for a self-hosted app',
      workspacePath: workspace,
    });

    const store = new HelmrSQLiteStore(join(dataDir, 'helmr.db'));
    await store.init();
    const swarm = await store.getSwarmByJob(result.jobId);
    const tasks = swarm ? await store.listSwarmTasks(swarm.id) : [];
    store.close();

    assert.equal(result.status, 'succeeded');
    assert.match(result.answer, /Research Swarm Results/);
    assert.equal(swarm?.status, 'succeeded');
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every((task) => task.status === 'succeeded'));
  } finally {
    if (previousDataDir === undefined) delete process.env['HELMR_DATA_DIR'];
    else process.env['HELMR_DATA_DIR'] = previousDataDir;
    if (previousAuditDir === undefined) delete process.env['HELMR_AUDIT_DIR'];
    else process.env['HELMR_AUDIT_DIR'] = previousAuditDir;
    for (const [key, value] of previousModelEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
