import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MultiAgentRuntime, MockWorkspaceProvider } from '../packages/embodiment/src/index.js';
import { orchestrateSwarm, looksLikeParallelResearch } from './orchestrator.js';
import { getAgentRuntime, resetAgentRuntime, createWorkspaceProvider } from './agent-runtime.js';

test('orchestrateSwarm spawns one embodied agent per subtask and merges results', async () => {
  const runtime = new MultiAgentRuntime(new MockWorkspaceProvider(), { mode: 'swarm' });
  const { results, merged } = await orchestrateSwarm({
    runtime,
    subtasks: [
      { role: 'research', task: 'Research competitors' },
      { role: 'pricing', task: 'Compare pricing' },
      { role: 'docs', task: 'Check the docs' },
    ],
  });

  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.status === 'done'));
  assert.match(merged, /research/);
  assert.match(merged, /pricing/);
  assert.match(merged, /docs/);

  // Each subtask is recorded in the shared ledger and completed.
  const tasks = runtime.ledger.all();
  assert.equal(tasks.length, 3);
  assert.ok(tasks.every((t) => t.status === 'done'));

  // Distinct workspaces — no shared body across agents.
  const workspaces = new Set(tasks.map((t) => t.workspaceId));
  assert.equal(workspaces.size, 3);

  // keepAlive defaults to false, so bodies are cleaned up.
  assert.equal(runtime.list().length, 0);
});

test('orchestrateSwarm can keep agents alive for the live Agents view', async () => {
  const runtime = new MultiAgentRuntime(new MockWorkspaceProvider());
  await orchestrateSwarm({
    runtime,
    keepAlive: true,
    subtasks: [{ role: 'research', task: 'Look around' }],
  });

  const live = runtime.snapshot();
  assert.equal(live.length, 1);
  assert.equal(live[0]?.taskState.status, 'done');
  await runtime.shutdown();
});

test('getAgentRuntime is a process singleton (orchestrator and Hatchery share it)', () => {
  resetAgentRuntime();
  const a = getAgentRuntime();
  const b = getAgentRuntime();
  assert.equal(a, b);
  resetAgentRuntime();
});

test('default workspace provider is the mock provider unless browser is selected', () => {
  assert.equal(createWorkspaceProvider({}).kind, 'mock');
  assert.equal(createWorkspaceProvider({ HELMR_WORKSPACE_PROVIDER: 'browser' }).kind, 'browser-context');
});

test('looksLikeParallelResearch recognizes multi-target research requests', () => {
  assert.equal(
    looksLikeParallelResearch('Research competitors, compare pricing, and check the docs'),
    true,
  );
  assert.equal(looksLikeParallelResearch('summarize this file'), false);
});
