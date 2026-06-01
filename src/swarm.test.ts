import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { HelmrSQLiteStore } from '../packages/memory/src/sqlite-store.js';
import {
  createSwarmPlan,
  decomposeRequest,
  looksLikeCodingRequest,
  looksLikeParallelResearch,
  orchestrateSwarm,
  resolveSubtasks,
} from './swarm.js';

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

test('looksLikeParallelResearch detects wide research and rejects coding/simple requests', () => {
  assert.equal(looksLikeParallelResearch('research the tradeoffs of event sourcing'), true);
  assert.equal(
    looksLikeParallelResearch('compare Postgres, MySQL, and SQLite for a self-hosted app'),
    true,
  );
  assert.equal(looksLikeParallelResearch('investigate options for background job queues'), true);

  // Coding intent must not fan out to a read-only swarm.
  assert.equal(looksLikeCodingRequest('implement a retry function in runtime.ts'), true);
  assert.equal(looksLikeParallelResearch('implement a retry function in runtime.ts'), false);

  // A simple single-fact lookup is not a swarm.
  assert.equal(looksLikeParallelResearch('what node version is required?'), false);
});

test('decomposeRequest splits explicit lists and fans broad questions into angles', () => {
  const list = decomposeRequest('compare React, Vue, and Svelte');
  assert.deepEqual(list, ['React', 'Vue', 'Svelte']);

  const bullets = decomposeRequest('research:\n- caching strategies\n- database indexing\n- CDN options');
  assert.deepEqual(bullets, ['caching strategies', 'database indexing', 'CDN options']);

  const broad = decomposeRequest('research the state of WebAssembly runtimes');
  assert.equal(broad.length, 3);
  assert.ok(broad.every((s) => s.includes('WebAssembly')));

  // Non-research prose with no structure stays a single task.
  assert.deepEqual(decomposeRequest('tell me about it'), ['tell me about it']);
});

test('resolveSubtasks falls back to the heuristic without a model provider', async () => {
  const previousModelEnv = new Map<string, string | undefined>(
    MODEL_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of MODEL_ENV_KEYS) delete process.env[key];
    const subtasks = await resolveSubtasks('compare React, Vue, and Svelte');
    assert.deepEqual(subtasks, decomposeRequest('compare React, Vue, and Svelte'));
  } finally {
    for (const [key, value] of previousModelEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('createSwarmPlan produces a low-risk read-only plan mirroring subtasks', () => {
  const plan = createSwarmPlan('job_1', 'compare A and B', ['A', 'B']);
  assert.equal(plan.risk, 'low');
  assert.equal(plan.requiresApproval, false);
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(
    plan.steps.flatMap((s) => s.requiredCapabilities),
    ['workspace_read', 'workspace_read'],
  );
  // Steps declare they can run in parallel with one another.
  assert.deepEqual(plan.steps[0]?.canRunInParallelWith, ['swarm_task_2']);
});

test('orchestrateSwarm fans out, persists every subtask, and synthesizes (local fallback)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helmr-swarm-test-'));
  const previousModelEnv = new Map<string, string | undefined>(
    MODEL_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  try {
    for (const key of MODEL_ENV_KEYS) delete process.env[key];

    const store = new HelmrSQLiteStore(join(dir, 'helmr.db'));
    await store.init();

    const subtasks = ['caching strategies', 'database indexing', 'CDN options'];
    await store.createSwarm({
      id: 'swarm_job_1',
      jobId: 'job_1',
      request: 'research performance options',
      subtasks,
      status: 'planned',
    });

    const result = await orchestrateSwarm({
      jobId: 'job_1',
      workspacePath: dir,
      store,
      concurrency: 2,
    });

    assert.equal(result.taskCount, 3);
    assert.equal(result.succeeded, 3);
    assert.equal(result.failed, 0);
    assert.match(result.answer, /Research Swarm Results/);

    const swarm = await store.getSwarmByJob('job_1');
    assert.equal(swarm?.status, 'succeeded');
    assert.equal(swarm?.summary, result.answer);

    const tasks = await store.listSwarmTasks('swarm_job_1');
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every((t) => t.status === 'succeeded'));
    assert.ok(tasks.every((t) => typeof t.output === 'string' && t.output.length > 0));

    store.close();
  } finally {
    for (const [key, value] of previousModelEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
