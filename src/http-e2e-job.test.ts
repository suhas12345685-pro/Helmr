import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runJob } from './runtime.js';
import { getHelmrPaths } from './paths.js';
import { createGatewayApp } from '../packages/gateway/src/http-server.js';
import { createHatcheryApp } from '../packages/hatchery-api/src/server.js';
import { HelmrSQLiteStore } from '../packages/memory/src/sqlite-store.js';
import { JsonlAuditLog } from '../packages/memory/src/audit-jsonl.js';
import { ModelRouter } from '../packages/router/src/model-router.js';
import { DEFAULT_ROUTING } from '../packages/router/src/routing-config.js';
import { ConfigFileManager } from '../packages/config/src/config-files.js';
import type { Hono } from 'hono';
import type { HelmrPlan } from '../packages/shared/src/index.js';

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
let dbPath = '';
let gateway: Hono;
let hatchery: Hono;
let sharedStore: HelmrSQLiteStore;
const savedEnv: Record<string, string | undefined> = {};

// Intake body the Gateway accepts on POST /api/events.
function intakeBody(text: string) {
  return {
    text,
    workspace: { id: 'local', path: workspaceDir },
    principal: { id: 'local-owner', type: 'local-user', trustLevel: 'owner' },
    requestedCapabilities: ['workspace_read'],
  };
}

// Drive a Hono app the way an HTTP client would: a real Request in, a real
// Response out — no port binding required for a hermetic test.
function jsonRequest(app: Hono, path: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

before(async () => {
  // Isolate Helmr state under a throwaway directory so the HTTP e2e job never
  // touches the developer's ~/.helmr data.
  stateDir = await mkdtemp(join(tmpdir(), 'helmr-http-e2e-'));
  workspaceDir = await mkdtemp(join(tmpdir(), 'helmr-http-ws-'));

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
      { name: 'http-e2e-fixture', version: '0.0.1', scripts: { test: 'node --test' }, dependencies: {} },
      null,
      2,
    ),
    'utf8',
  );
  execFileSync('git', ['init', '-q'], { cwd: workspaceDir });

  // The Gateway, Hatchery, and runtime worker all share the one control-plane
  // database, exactly as they do in a real deployment.
  const paths = getHelmrPaths();
  dbPath = join(paths.dataDir, 'helmr.db');
  sharedStore = new HelmrSQLiteStore(dbPath);
  await sharedStore.init();

  const router = new ModelRouter(DEFAULT_ROUTING);
  gateway = createGatewayApp(sharedStore, router, { dataDir: paths.dataDir });

  const configManager = new ConfigFileManager(paths.configDir);
  await configManager.init();
  hatchery = createHatcheryApp(sharedStore, router, configManager, paths.dataDir);
});

after(async () => {
  sharedStore?.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
});

test('http e2e: Gateway intake queues a job that runs to a verifiable result and surfaces in Hatchery', async () => {
  // 1. Intake over HTTP through the Gateway, exactly as an API channel would.
  const intake = await jsonRequest(gateway, '/api/events', {
    method: 'POST',
    body: JSON.stringify(intakeBody('summarize this workspace')),
  });
  assert.equal(intake.status, 202);
  const intakeJson = (await intake.json()) as { jobId: string; eventId: string; status: string };
  assert.ok(intakeJson.jobId.startsWith('job_'));
  assert.equal(intakeJson.status, 'queued');

  // 2. The worker claims the queued job and runs the read-only plan to a result.
  const result = await runJob({
    text: 'summarize this workspace',
    workspacePath: workspaceDir,
    jobId: intakeJson.jobId,
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.jobId, intakeJson.jobId);

  // 3. The same job, read back over HTTP from Hatchery, reflects the success
  //    along with its plan summary and the tool receipts it produced.
  const view = await jsonRequest(hatchery, `/api/jobs/${intakeJson.jobId}`);
  assert.equal(view.status, 200);
  const viewJson = (await view.json()) as {
    job: { id: string; status: string; planSteps?: string[]; toolReceipts: unknown[] };
    plan: HelmrPlan | null;
  };
  assert.equal(viewJson.job.id, intakeJson.jobId);
  assert.equal(viewJson.job.status, 'succeeded');
  assert.ok(viewJson.plan, 'Hatchery should expose the persisted plan');
  assert.ok(viewJson.job.toolReceipts.length > 0, 'read steps should leave tool receipts');

  // 4. The append-only audit log covers the lifecycle and verifies.
  const audit = new JsonlAuditLog(getHelmrPaths().auditDir);
  const records = await audit.readJob(intakeJson.jobId);
  const kinds = records.map((r) => r.kind);
  assert.ok(kinds.includes('event'), 'audit should record the intake event');
  assert.ok(kinds.includes('plan'), 'audit should record the plan');
  assert.ok(kinds.includes('result'), 'audit should record the result');
  const verification = await audit.verifyJob(intakeJson.jobId);
  assert.equal(verification.valid, true, verification.failureReason);
});

test('http e2e: an approval-gated plan pauses at Hatchery and resumes after HTTP approval', async () => {
  // 1. Intake a write-capable request over the Gateway.
  const intake = await jsonRequest(gateway, '/api/events', {
    method: 'POST',
    body: JSON.stringify(intakeBody('apply a code change to the workspace')),
  });
  assert.equal(intake.status, 202);
  const { jobId } = (await intake.json()) as { jobId: string };

  // 2. A planner would produce a write-capable (approval-gated) plan; seed it so
  //    the runtime's real policy gate engages without needing a model key.
  const gatedPlan: HelmrPlan = {
    id: `plan_${jobId}`,
    jobId,
    summary: 'Modify a workspace file to apply the requested change.',
    risk: 'medium',
    requiresApproval: true,
    steps: [
      {
        id: 'edit_file',
        title: 'Write updated source file',
        kind: 'write',
        agent: 'coding',
        canRunInParallelWith: [],
        requiredCapabilities: ['workspace_write'],
      },
    ],
  };
  await sharedStore.savePlan(gatedPlan);

  // 3. The worker claims the job, the policy gate fires, and the job parks in
  //    awaiting_approval with a pending approval recorded.
  const paused = await runJob({
    text: 'apply a code change to the workspace',
    workspacePath: workspaceDir,
    jobId,
  });
  assert.equal(paused.status, 'awaiting_approval');

  // Faithfully record the seeded plan in the audit evidence, as the planner would.
  const audit = new JsonlAuditLog(getHelmrPaths().auditDir);
  await audit.append({ kind: 'plan', jobId, createdAt: new Date().toISOString(), data: gatedPlan });

  // 4. The approval is visible over HTTP in Hatchery with its risk + capability.
  const pending = await jsonRequest(hatchery, '/api/approvals');
  assert.equal(pending.status, 200);
  const pendingJson = (await pending.json()) as {
    approvals: Array<{ id: string; jobId: string; planSummary: string; capabilityRequired: string; riskLevel: string }>;
  };
  const approval = pendingJson.approvals.find((a) => a.jobId === jobId);
  assert.ok(approval, 'the gated job should surface a pending approval in Hatchery');
  assert.equal(approval?.id, `approval_${jobId}`);
  assert.equal(approval?.riskLevel, 'medium');
  assert.match(approval?.capabilityRequired ?? '', /workspace_write/);
  assert.equal(approval?.planSummary, gatedPlan.summary);

  // 5. Approve over HTTP through Hatchery.
  const decide = await jsonRequest(hatchery, `/api/approvals/${approval!.id}/approve`, { method: 'POST' });
  assert.equal(decide.status, 200);
  const decideJson = (await decide.json()) as { id: string; decision: string };
  assert.equal(decideJson.decision, 'approved');

  // 6. The decision is durable and the job is re-queued for execution.
  const stored = await sharedStore.getApproval(approval!.id);
  assert.equal(stored?.decision, 'approved');
  const job = await sharedStore.getJob(jobId);
  assert.equal(job?.status, 'queued', 'an approved plan re-queues the job for execution');

  // 7. Hatchery now shows the job as runnable (queued maps to a running-eligible
  //    state) rather than blocked on approval.
  const view = await jsonRequest(hatchery, `/api/jobs/${jobId}`);
  const viewJson = (await view.json()) as { job: { status: string } };
  assert.equal(viewJson.job.status, 'queued');

  // 8. The audit evidence for the gated job verifies intact.
  const verification = await audit.verifyJob(jobId);
  assert.equal(verification.valid, true, verification.failureReason);
  const kinds = (await audit.readJob(jobId)).map((r) => r.kind);
  assert.ok(kinds.includes('event'), 'audit should record the intake event');
  assert.ok(kinds.includes('plan'), 'audit should record the gated plan');

  // The worker claims the highest-priority queued job globally (one shared
  // control plane), so retire this re-queued write-plan job now that the
  // approval transition is verified — executing it would require a model key,
  // which is out of scope for this HTTP intake/approval test.
  await sharedStore.updateJobStatus(jobId, 'cancelled');
});

test('http e2e: denying a gated plan in Hatchery fails the job', async () => {
  const intake = await jsonRequest(gateway, '/api/events', {
    method: 'POST',
    body: JSON.stringify(intakeBody('delete a file from the workspace')),
  });
  const { jobId } = (await intake.json()) as { jobId: string };

  const gatedPlan: HelmrPlan = {
    id: `plan_${jobId}`,
    jobId,
    summary: 'Delete a workspace file.',
    risk: 'high',
    requiresApproval: true,
    steps: [
      {
        id: 'remove_file',
        title: 'Delete obsolete source file',
        kind: 'write',
        agent: 'coding',
        canRunInParallelWith: [],
        requiredCapabilities: ['workspace_write'],
      },
    ],
  };
  await sharedStore.savePlan(gatedPlan);

  const paused = await runJob({
    text: 'delete a file from the workspace',
    workspacePath: workspaceDir,
    jobId,
  });
  assert.equal(paused.status, 'awaiting_approval');

  const deny = await jsonRequest(hatchery, `/api/approvals/approval_${jobId}/deny`, { method: 'POST' });
  assert.equal(deny.status, 200);
  const denyJson = (await deny.json()) as { decision: string };
  assert.equal(denyJson.decision, 'denied');

  const job = await sharedStore.getJob(jobId);
  assert.equal(job?.status, 'failed', 'a denied plan fails the job');
});
