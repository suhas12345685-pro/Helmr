import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runJob } from './runtime.js';
import { KillSwitch } from '../packages/scheduler/src/kill-switch.js';
import { getHelmrPaths } from './paths.js';

const MODEL_ENV_KEYS = [
  'HELMR_MODEL', 'HELMR_COUNCIL_MODEL', 'HELMR_RESEARCH_MODEL', 'HELMR_CODING_MODEL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY', 'XAI_API_KEY', 'PERPLEXITY_API_KEY',
];

let stateDir = '';
let workspaceDir = '';
const savedEnv: Record<string, string | undefined> = {};

before(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'helmr-autonomy-'));
  workspaceDir = await mkdtemp(join(tmpdir(), 'helmr-autonomy-ws-'));

  for (const key of ['HELMR_DATA_DIR', 'HELMR_CONFIG_DIR', 'HELMR_AUDIT_DIR', ...MODEL_ENV_KEYS]) {
    savedEnv[key] = process.env[key];
  }
  process.env['HELMR_DATA_DIR'] = join(stateDir, 'data');
  process.env['HELMR_CONFIG_DIR'] = join(stateDir, 'config');
  process.env['HELMR_AUDIT_DIR'] = join(stateDir, 'data', 'audit');
  for (const key of MODEL_ENV_KEYS) delete process.env[key];

  // The runtime creates the data dir via store.init() before opening the
  // kill-switch DB; create it up front so the test's own KillSwitch can too.
  await mkdir(join(stateDir, 'data'), { recursive: true });

  await writeFile(
    join(workspaceDir, 'package.json'),
    JSON.stringify({ name: 'autonomy-fixture', version: '0.0.1' }, null, 2),
    'utf8',
  );
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

async function dbUrl(): Promise<string> {
  return `file:${join(getHelmrPaths().dataDir, 'helmr.db')}`;
}

beforeEach(async () => {
  // Ensure each test starts with autonomy un-recalled.
  const ks = await KillSwitch.create({ url: await dbUrl() });
  try {
    await ks.resume();
  } finally {
    ks.close();
  }
});

test('a job runs normally when the kill-switch is not engaged', async () => {
  const result = await runJob({ text: 'summarize this workspace', workspacePath: workspaceDir });
  assert.equal(result.status, 'succeeded');
});

test('engaging the kill-switch halts new jobs before any work runs', async () => {
  const ks = await KillSwitch.create({ url: await dbUrl() });
  try {
    await ks.halt('global', 'operator pressed emergency stop');
  } finally {
    ks.close();
  }

  const result = await runJob({ text: 'summarize this workspace', workspacePath: workspaceDir });
  assert.equal(result.status, 'halted');
  assert.match(result.answer, /emergency stop/);
  assert.deepEqual(result.deniedReasons, ['operator pressed emergency stop']);
});

test('resuming after a halt lets jobs run again', async () => {
  const ks = await KillSwitch.create({ url: await dbUrl() });
  try {
    await ks.halt();
    assert.equal((await runJob({ text: 'summarize again', workspacePath: workspaceDir })).status, 'halted');
    await ks.resume();
  } finally {
    ks.close();
  }
  const result = await runJob({ text: 'summarize once more', workspacePath: workspaceDir });
  assert.equal(result.status, 'succeeded');
});
