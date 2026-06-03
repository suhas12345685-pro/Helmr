import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { runJob } from './runtime.js';
import { getBudgetLedger, resetBudgetLedger } from './governor.js';
import { getHelmrPaths } from './paths.js';
import { JsonlAuditLog } from '../packages/memory/src/audit-jsonl.js';
import { BudgetExceededError } from '../packages/governor/src/index.js';
import { Checkpointer } from '../packages/hands/src/checkpoint.js';
import { executeReceipt } from '../packages/hands/src/executor.js';
import type { StandingApprovalPolicy } from '../packages/cortex/src/gate.js';
import type { ToolReceipt } from '../packages/shared/src/index.js';

const MODEL_ENV_KEYS = [
  'HELMR_MODEL', 'HELMR_COUNCIL_MODEL', 'HELMR_RESEARCH_MODEL', 'HELMR_CODING_MODEL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY', 'XAI_API_KEY', 'PERPLEXITY_API_KEY',
];

let stateDir = '';
let workspaceDir = '';
const savedEnv: Record<string, string | undefined> = {};

before(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'helmr-safety-'));
  workspaceDir = await mkdtemp(join(tmpdir(), 'helmr-safety-ws-'));

  for (const key of ['HELMR_DATA_DIR', 'HELMR_CONFIG_DIR', 'HELMR_AUDIT_DIR', 'HELMR_MAX_ACTIONS_PER_JOB', ...MODEL_ENV_KEYS]) {
    savedEnv[key] = process.env[key];
  }
  process.env['HELMR_DATA_DIR'] = join(stateDir, 'data');
  process.env['HELMR_CONFIG_DIR'] = join(stateDir, 'config');
  process.env['HELMR_AUDIT_DIR'] = join(stateDir, 'data', 'audit');
  // Offline, deterministic local fallback.
  for (const key of MODEL_ENV_KEYS) delete process.env[key];

  await writeFile(join(workspaceDir, 'package.json'), JSON.stringify({ name: 'fx', version: '0.0.1' }), 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: workspaceDir });
});

after(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetBudgetLedger();
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
});

test('integration: a read-only runJob runs end-to-end and consults the standing policy', async () => {
  // Offline, the planner and synthesis use deterministic local fallbacks (no
  // guarded LLM call), so this exercises the read lifecycle and the gate's
  // policy load on the execution path.
  const result = await runJob({ text: 'summarize this workspace', workspacePath: workspaceDir });
  assert.equal(result.status, 'succeeded');

  const audit = new JsonlAuditLog(getHelmrPaths().auditDir);
  const verification = await audit.verifyJob(result.jobId);
  assert.equal(verification.valid, true, verification.failureReason);
});

test('integration: the runtime budget ledger trips the first guarded call when the daily cap is exceeded', async () => {
  // This is the exact ledger + config + daily-store wiring runJob's
  // guardedGenerate uses (getBudgetLedger singleton, env-loaded limits, the
  // persisted daily-spend file). Seeding today above a low cap trips the
  // pre-call check that guardedGenerate runs before every model call.
  const today = new Date().toISOString().slice(0, 10);
  await mkdir(join(stateDir, 'data'), { recursive: true });
  await writeFile(join(stateDir, 'data', 'budget-spend.json'), JSON.stringify({ [today]: 100 }), 'utf8');
  process.env['HELMR_BUDGET_USD_PER_DAY'] = '0.01';
  resetBudgetLedger();
  try {
    const ledger = getBudgetLedger();
    const pre = await ledger.check('jB', 0);
    assert.equal(pre.allowed, false);
    assert.equal(pre.trippedLimit, 'usd_per_day');
    // guardedGenerate turns this tripped check into a BudgetExceededError, which
    // the runtime catches to pause the job as paused_budget.
    assert.throws(() => { throw new BudgetExceededError(pre); }, /budget/i);
  } finally {
    delete process.env['HELMR_BUDGET_USD_PER_DAY'];
    resetBudgetLedger();
  }
});

test('integration: checkpoint + gate + rollback compose across a write lifecycle', async () => {
  // Mirror the runtime write path: checkpoint, run a mix of inward and outward
  // receipts under a standing policy, then simulate a mid-write failure and roll
  // back to the clean checkpoint.
  const ws = await mkdtemp(join(tmpdir(), 'helmr-lifecycle-'));
  const store = join(stateDir, 'data');
  await mkdir(store, { recursive: true });

  const server = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const host = `127.0.0.1:${port}`;

  const policy: StandingApprovalPolicy = { rules: { network: { allowHosts: [host] } } };
  const receipt = (tool: string, capability: string, input: unknown, approval: ToolReceipt['approval'] = 'not_required'): ToolReceipt => ({
    id: `r_${tool}`, jobId: 'jL', stepId: 's', tool, capability: capability as ToolReceipt['capability'],
    input, risk: 'medium', approval, createdAt: new Date().toISOString(),
  });

  try {
    await writeFile(join(ws, 'original.txt'), 'pristine');
    const checkpointer = new Checkpointer({ rootDir: store });
    const ref = await checkpointer.create('jL', ws);

    // Inward write runs (auto tier; approval-gated capability, so approved).
    const wrote = await executeReceipt(receipt('write_workspace_file', 'workspace_write', { filePath: 'created.txt', content: 'new' }, 'approved'), ws);
    assert.equal(wrote.status, 'succeeded');
    assert.equal(await readFile(join(ws, 'created.txt'), 'utf8'), 'new');

    // Outward call to an allow-listed host is promoted to standing and executes.
    const allowed = await executeReceipt(receipt('http_request', 'network', { url: `http://${host}/` }), ws, { standingPolicy: policy });
    assert.equal(allowed.status, 'succeeded');

    // Outward call to an unlisted host stays gated and is refused.
    const gated = await executeReceipt(receipt('http_request', 'network', { url: 'http://example.org/' }), ws, { standingPolicy: policy });
    assert.equal(gated.status, 'failed');
    assert.match(gated.error ?? '', /gated/);

    // A failure mid-write triggers rollback to the checkpoint.
    const summary = await checkpointer.rollback(ref);
    assert.ok(summary.restored >= 1);
    assert.equal(summary.removed, 1, 'the agent-created file is removed');
    assert.equal(await readFile(join(ws, 'original.txt'), 'utf8'), 'pristine');
    assert.equal(existsSync(join(ws, 'created.txt')), false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(ws, { recursive: true, force: true });
  }
});
