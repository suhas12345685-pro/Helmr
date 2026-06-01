import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MultiAgentRuntime,
  MockWorkspaceProvider,
  PermissionDeniedError,
} from './index.js';

test('spawns many agents, each with its own isolated body', async () => {
  const runtime = new MultiAgentRuntime(new MockWorkspaceProvider(), { mode: 'swarm' });
  const agents = await runtime.spawnAgents([
    { role: 'research' },
    { role: 'verify' },
    { role: 'write' },
    { role: 'qa' },
  ]);

  assert.equal(agents.length, 4);
  assert.equal(runtime.list().length, 4);

  // Distinct agent ids and distinct workspaces — no shared body.
  const agentIds = new Set(agents.map((a) => a.agentId));
  const workspaceIds = new Set(agents.map((a) => a.workspaceId));
  assert.equal(agentIds.size, 4);
  assert.equal(workspaceIds.size, 4);

  for (const body of agents) {
    assert.equal(body.status, 'idle');
    assert.equal(body.vision.workspaceId, body.workspaceId);
    assert.equal(body.keyboard.workspaceId, body.workspaceId);
    assert.equal(body.mouse.workspaceId, body.workspaceId);
  }

  await runtime.shutdown();
});

test('agents never share a keyboard, mouse, or session', async () => {
  const provider = new MockWorkspaceProvider();
  const runtime = new MultiAgentRuntime(provider);
  const [a, b] = await runtime.spawnAgents([
    { role: 'a', permissions: ['read_only', 'workspace_only'] },
    { role: 'b', permissions: ['read_only', 'workspace_only'] },
  ]);

  // Seed each isolated screen with a text field.
  provider.seedUI(a.workspaceId, [{ id: 'field', role: 'textbox', name: 'Search' }]);
  provider.seedUI(b.workspaceId, [{ id: 'field', role: 'textbox', name: 'Search' }]);

  // Agent A types into its own workspace.
  await a.keyboard.sendText('field', 'hello from A');
  await a.mouse.move(10, 20);

  // Agent B's workspace is untouched by A's keyboard/mouse.
  const obsA = await a.vision.observe();
  const obsB = await b.vision.observe();

  assert.equal(obsA.uiElements?.find((e) => e.id === 'field')?.value, 'hello from A');
  assert.equal(obsB.uiElements?.find((e) => e.id === 'field')?.value, undefined);
  assert.deepEqual(b.mouse.position(), { x: 0, y: 0 });
  assert.notDeepEqual(a.mouse.position(), b.mouse.position());

  // The keyboard/mouse instances are not the same objects.
  assert.notEqual(a.keyboard, b.keyboard);
  assert.notEqual(a.mouse, b.mouse);

  await runtime.shutdown();
});

test('read-only agents cannot drive the keyboard or mouse', async () => {
  const runtime = new MultiAgentRuntime(new MockWorkspaceProvider());
  const agent = await runtime.spawnAgent({ role: 'observer', permissions: ['read_only'] });

  await assert.rejects(() => agent.keyboard.type('nope'), PermissionDeniedError);
  await assert.rejects(() => agent.mouse.click(1, 1), PermissionDeniedError);

  // But it can still observe its workspace.
  const obs = await agent.vision.observe();
  assert.equal(obs.workspaceId, agent.workspaceId);

  await runtime.shutdown();
});

test('lifecycle: assign, pause, resume, complete, and collect results', async () => {
  const runtime = new MultiAgentRuntime(new MockWorkspaceProvider());
  const agent = await runtime.spawnAgent({ role: 'research' });

  runtime.assignTask(agent.agentId, { description: 'Research competitors' });
  assert.equal(runtime.status(agent.agentId), 'working');

  runtime.pauseAgent(agent.agentId);
  assert.equal(runtime.status(agent.agentId), 'paused');
  runtime.resumeAgent(agent.agentId);
  assert.equal(runtime.status(agent.agentId), 'working');

  runtime.completeTask(agent.agentId, { summary: 'done' });
  const results = runtime.collectResults();
  assert.equal(results.length, 1);
  assert.deepEqual(results[0]?.result, { summary: 'done' });

  // The ledger recorded the task end to end.
  const tasks = runtime.ledger.all();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.status, 'done');
  assert.equal(tasks[0]?.assignedAgentId, agent.agentId);

  await runtime.shutdown();
});

test('killUnhealthy stops agents with a stale heartbeat', async () => {
  const runtime = new MultiAgentRuntime(new MockWorkspaceProvider(), { heartbeatTimeoutMs: 1000 });
  const agent = await runtime.spawnAgent({ role: 'stale' });

  // Nothing stale yet.
  assert.deepEqual(await runtime.killUnhealthy(Date.now()), []);

  // Far in the future, the heartbeat is stale.
  const killed = await runtime.killUnhealthy(Date.now() + 60_000);
  assert.deepEqual(killed, [agent.agentId]);
  assert.equal(runtime.get(agent.agentId), undefined);
});

test('stopAgent destroys the workspace so it can no longer be observed', async () => {
  const provider = new MockWorkspaceProvider();
  const runtime = new MultiAgentRuntime(provider);
  const agent = await runtime.spawnAgent({ role: 'temp' });
  const workspaceId = agent.workspaceId;

  await runtime.stopAgent(agent.agentId);
  await assert.rejects(() => provider.attachVision(workspaceId), /does not exist/);
});
